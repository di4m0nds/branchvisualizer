import { invoke, isTauri } from '../../platform';
import type {
  AgentRequest, AgentTransport, ModelInfo, NeutralContent, NeutralMessage, NeutralResponse,
  NeutralStopReason, ProbeResult, Provider, StreamCallbacks,
} from '../transport';

// MiniMax exposes an OpenAI-compatible chat/completions endpoint. We use raw
// fetch — no official JS SDK — and stream Server-Sent Events.

const BASE_URL = 'https://api.minimaxi.chat/v1';

const MODELS: ModelInfo[] = [
  { id: 'MiniMax-M2',            label: 'MiniMax M2 (open-weights)', defaultTier: 'paid', contextTokens: 200_000 },
  { id: 'MiniMax-Text-01',       label: 'MiniMax Text-01',           defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'abab6.5s-chat',         label: 'abab6.5s',                  defaultTier: 'paid', contextTokens: 245_000 },
];

async function resolveKey(): Promise<string | null> {
  if (isTauri()) {
    const k = await invoke<string | null>('get_provider_key', { name: 'minimax' }).catch(() => null);
    if (k) return k;
  }
  return import.meta.env.VITE_MINIMAX_API_KEY ?? null;
}

// ─── Adapters (OpenAI-compatible chat format) ─────────────────────────────

interface OaiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

function toChatMessages(system: string, msgs: NeutralMessage[]): OaiChatMessage[] {
  const out: OaiChatMessage[] = [{ role: 'system', content: system }];
  for (const m of msgs) {
    // Group by role turn — tool_use blocks attach to the assistant, tool_result
    // becomes a role:'tool' follow-up.
    let toolCalls: OaiChatMessage['tool_calls'] = undefined;
    let text = '';
    const trailingTools: OaiChatMessage[] = [];
    for (const c of m.content) {
      switch (c.type) {
        case 'text': if (c.text) text += (text ? '\n' : '') + c.text; break;
        case 'tool_use':
          toolCalls ??= [];
          toolCalls.push({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } });
          break;
        case 'tool_result':
          trailingTools.push({ role: 'tool', tool_call_id: c.toolUseId, content: c.content });
          break;
        case 'thinking': break;
      }
    }
    if (text || toolCalls) out.push({ role: m.role, content: text || undefined, tool_calls: toolCalls });
    out.push(...trailingTools);
  }
  return out;
}

interface StreamChoiceDelta {
  content?: string;
  tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
}
interface StreamChunk {
  choices?: Array<{ delta?: StreamChoiceDelta; finish_reason?: string }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

async function* iterateSSE(res: Response): AsyncGenerator<StreamChunk> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let lineEnd;
    while ((lineEnd = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, lineEnd).trim();
      buf = buf.slice(lineEnd + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { yield JSON.parse(data) as StreamChunk; } catch { /* skip malformed frame */ }
    }
  }
}

class MiniMaxTransport implements AgentTransport {
  readonly id = 'minimax';
  constructor(readonly modelId: string, private apiKey: string) {}

  async createMessage(req: AgentRequest, cbs: StreamCallbacks): Promise<NeutralResponse> {
    const body = {
      model: this.modelId,
      messages: toChatMessages(req.system, req.messages),
      tools: req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
      max_tokens: req.maxTokens,
      stream: true,
    };

    const res = await fetch(`${BASE_URL}/text/chatcompletion_v2`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`MiniMax error ${res.status}: ${await res.text().catch(() => '')}`);

    const content: NeutralContent[] = [];
    const pendingToolCalls: Record<number, { id?: string; name: string; args: string }> = {};
    let text = '';
    let stopReason: NeutralStopReason = 'end_turn';
    let providerModel = this.modelId;
    let inputTokens = 0, outputTokens = 0, total = 0;

    for await (const chunk of iterateSSE(res)) {
      if (chunk.model) providerModel = chunk.model;
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
        total = chunk.usage.total_tokens ?? (inputTokens + outputTokens);
      }
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) { text += delta.content; cbs.onText?.(delta.content); }
      for (const tc of delta?.tool_calls ?? []) {
        const p = pendingToolCalls[tc.index] ??= { id: undefined, name: '', args: '' };
        if (tc.id) p.id = tc.id;
        if (tc.function?.name) p.name += tc.function.name;
        if (tc.function?.arguments) p.args += tc.function.arguments;
      }
      if (choice?.finish_reason === 'tool_calls') stopReason = 'tool_use';
      else if (choice?.finish_reason === 'length') stopReason = 'max_tokens';
      else if (choice?.finish_reason === 'stop') stopReason = 'end_turn';
    }

    if (text) content.push({ type: 'text', text });
    for (const p of Object.values(pendingToolCalls)) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(p.args || '{}'); } catch { input = { _raw: p.args }; }
      content.push({ type: 'tool_use', id: p.id ?? p.name, name: p.name, input });
    }

    return {
      content,
      stopReason,
      usage: { inputTokens, outputTokens, total },
      providerModel,
    };
  }
}

export const minimaxProvider: Provider = {
  id: 'minimax',
  label: 'MiniMax',
  description: 'MiniMax M2 / Text-01 / abab6.5s via OpenAI-compatible API.',
  models: () => MODELS,

  async probe(): Promise<ProbeResult> {
    const key = await resolveKey();
    if (!key) return { state: 'not_detected', tier: 'unknown', label: 'MINIMAX_API_KEY not set' };
    try {
      // MiniMax doesn't publish a free ping; a tiny chat completion is the cheapest check.
      const res = await fetch(`${BASE_URL}/text/chatcompletion_v2`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'abab6.5s-chat', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { state: 'connected', tier: 'unknown', label: 'key ok · 1-token probe' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { state: 'detected', tier: 'unknown', label: 'key present but request failed', error: msg };
    }
  },

  async createTransport(modelId: string): Promise<AgentTransport> {
    const key = await resolveKey();
    if (!key) throw new Error('MiniMax key not found. Set MINIMAX_API_KEY.');
    return new MiniMaxTransport(modelId, key);
  },
};
