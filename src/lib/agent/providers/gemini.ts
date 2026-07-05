import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from '@google/genai';
import { makeKeyResolver, probeWithKey } from './shared';
import type {
  AgentRequest, AgentTransport, ModelInfo, NeutralContent, NeutralMessage, NeutralResponse,
  NeutralStopReason, NeutralUsage, ProbeResult, Provider, StreamCallbacks,
} from '../transport';

const MODELS: ModelInfo[] = [
  { id: 'gemini-3.5-flash',       label: 'Gemini 3.5 Flash',      defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro',        defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'gemini-3.1-flash-lite',  label: 'Gemini 3.1 Flash-Lite', defaultTier: 'free', contextTokens: 1_000_000 },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash',        defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro',        defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash',      defaultTier: 'free', contextTokens: 1_000_000 },
  { id: 'gemini-2.5-flash-lite',  label: 'Gemini 2.5 Flash-Lite', defaultTier: 'free', contextTokens: 1_000_000 },
];

const resolveKey = makeKeyResolver('gemini', () => import.meta.env.VITE_GEMINI_API_KEY);

// ─── Adapters ─────────────────────────────────────────────────────────────

function toGenaiContents(system: string, msgs: NeutralMessage[]): { systemInstruction: string; contents: Content[] } {
  const contents: Content[] = [];
  for (const m of msgs) {
    const parts: Part[] = [];
    // Attachments (images/PDFs) lead the user turn as inlineData parts.
    for (const a of m.attachments ?? []) {
      if (!a.base64) continue;
      if (a.kind === 'image' || a.mime === 'application/pdf') {
        parts.push({ inlineData: { mimeType: a.mime, data: a.base64 } });
      }
    }
    for (const c of m.content) {
      switch (c.type) {
        case 'text': if (c.text) parts.push({ text: c.text }); break;
        case 'tool_use':
          parts.push({ functionCall: { name: c.name, args: c.input } });
          break;
        case 'tool_result':
          parts.push({ functionResponse: { name: 'result', response: { output: c.content, isError: c.isError ?? false } } });
          break;
        case 'thinking': break;
      }
    }
    if (parts.length === 0) continue;
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return { systemInstruction: system, contents };
}

class GeminiTransport implements AgentTransport {
  readonly id = 'gemini';
  constructor(readonly modelId: string, private client: GoogleGenAI) {}

  async createMessage(req: AgentRequest, cbs: StreamCallbacks): Promise<NeutralResponse> {
    const { systemInstruction, contents } = toGenaiContents(req.system, req.messages);
    const functionDecls: FunctionDeclaration[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: t.inputSchema,
    }));

    const budget =
      req.effort === 'max' ? -1
      : req.effort === 'high' ? 8192
      : req.effort === 'medium' ? 2048
      : 0;

    const stream = await this.client.models.generateContentStream({
      model: this.modelId,
      contents,
      config: {
        systemInstruction,
        tools: functionDecls.length ? [{ functionDeclarations: functionDecls }] : undefined,
        maxOutputTokens: req.maxTokens,
        temperature: req.temperature,
        thinkingConfig: req.thinking ? { thinkingBudget: budget, includeThoughts: true } : undefined,
        abortSignal: req.signal,
      },
    });

    const content: NeutralContent[] = [];
    let sawToolCall = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let providerModel = this.modelId;

    for await (const chunk of stream) {
      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
      if (chunk.modelVersion) providerModel = chunk.modelVersion;

      for (const cand of chunk.candidates ?? []) {
        for (const part of cand.content?.parts ?? []) {
          if (part.text) {
            if (part.thought) cbs.onThinking?.(part.text);
            else { cbs.onText?.(part.text); content.push({ type: 'text', text: part.text }); }
          } else if (part.functionCall) {
            sawToolCall = true;
            const args = (part.functionCall.args ?? {}) as Record<string, unknown>;
            content.push({
              type: 'tool_use',
              id: part.functionCall.id ?? `${part.functionCall.name}_${content.length}`,
              name: part.functionCall.name ?? '',
              input: args,
            });
          }
        }
      }
    }

    // Coalesce split text blocks so downstream renders as one paragraph.
    const coalesced: NeutralContent[] = [];
    for (const c of content) {
      const last = coalesced[coalesced.length - 1];
      if (c.type === 'text' && last?.type === 'text') last.text += c.text;
      else coalesced.push(c);
    }

    const usage: NeutralUsage = { inputTokens, outputTokens, total: inputTokens + outputTokens };
    const stopReason: NeutralStopReason = sawToolCall ? 'tool_use' : 'end_turn';
    return { content: coalesced, stopReason, usage, providerModel };
  }
}

export const geminiProvider: Provider = {
  id: 'gemini',
  label: 'Gemini',
  description: 'Google Gemini 2.5 — Pro / Flash / Flash-Lite.',
  models: () => MODELS,

  async probe(): Promise<ProbeResult> {
    return probeWithKey(resolveKey, 'GEMINI_API_KEY not set', async (key) => {
      const client = new GoogleGenAI({ apiKey: key });
      // countTokens is the cheapest health probe.
      const resp = await client.models.countTokens({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      });
      return { tier: 'unknown', label: `key ok · ${resp.totalTokens ?? '?'} tok probe` };
    });
  },

  async createTransport(modelId: string): Promise<AgentTransport> {
    const key = await resolveKey();
    if (!key) throw new Error('Gemini API key not found. Set GEMINI_API_KEY.');
    return new GeminiTransport(modelId, new GoogleGenAI({ apiKey: key }));
  },
};
