// ─── OpenAI-compatible provider factory ──────────────────────────────────────
// Generalization of the MiniMax raw-fetch + SSE pattern: any endpoint speaking
// the OpenAI chat/completions dialect (OpenRouter, xAI, DeepSeek, Ollama,
// user-defined custom endpoints) is described by a spec and materialized into
// a full `Provider`. No SDK dependency — plain fetch + SSE.

import { makeKeyResolver } from './shared';
import type {
  AgentRequest, AgentTransport, ConnectionTier, ModelInfo, NeutralContent, NeutralMessage,
  NeutralResponse, NeutralStopReason, ProbeResult, Provider, StreamCallbacks,
} from '../transport';

export interface OaiCompatSpec {
  id: string;
  label: string;
  description: string;
  /** Base URL WITHOUT a trailing slash, e.g. `https://api.deepseek.com/v1`. */
  baseUrl: string;
  /** Chat endpoint path (default `/chat/completions`). */
  chatPath?: string;
  /** Static model list (fallback when no dynamic list is available). */
  staticModels: ModelInfo[];
  /** Stored-key name for the standard resolver chain. Omit for keyless local
   *  endpoints (Ollama). */
  keyName?: string;
  /** Statically-analyzable `import.meta.env.VITE_…` thunk (see makeKeyResolver). */
  viteEnv?: () => string | undefined;
  missingKeyLabel?: string;
  /** Extra request headers (e.g. OpenRouter attribution). */
  headers?: Record<string, string>;
  /** Optional dynamic model listing, run at probe time; result replaces
   *  `staticModels` in `models()` until the next reload. */
  listModels?: (key: string | null, baseUrl: string) => Promise<ModelInfo[] | null>;
  /** Liveness ping (default: GET `{baseUrl}/models`). Throw on failure. */
  ping?: (key: string | null, baseUrl: string) => Promise<{ tier: ConnectionTier; label: string }>;
}

// ─── Adapters (OpenAI chat dialect) ─────────────────────────────────────────

interface OaiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export function toChatMessages(system: string, msgs: NeutralMessage[]): OaiChatMessage[] {
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
  reasoning_content?: string; // DeepSeek reasoner / OpenRouter reasoning field
  tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
}
interface StreamChunk {
  choices?: Array<{ delta?: StreamChoiceDelta; finish_reason?: string }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export async function* iterateSSE(res: Response): AsyncGenerator<StreamChunk> {
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

// ─── Transport ───────────────────────────────────────────────────────────────

class OaiCompatTransport implements AgentTransport {
  constructor(
    readonly id: string,
    readonly modelId: string,
    private url: string,
    private apiKey: string | null,
    private extraHeaders: Record<string, string>,
    private label: string,
  ) {}

  async createMessage(req: AgentRequest, cbs: StreamCallbacks): Promise<NeutralResponse> {
    const body = {
      model: this.modelId,
      messages: toChatMessages(req.system, req.messages),
      ...(req.tools.length ? {
        tools: req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
      } : {}),
      max_tokens: req.maxTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      stream: true,
      // Ask for usage in the final stream frame (OpenAI/OpenRouter dialect;
      // servers that don't know the option ignore it).
      stream_options: { include_usage: true },
    };

    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`${this.label} error ${res.status}: ${await res.text().catch(() => '')}`);

    const content: NeutralContent[] = [];
    const pendingToolCalls: Record<number, { id?: string; name: string; args: string }> = {};
    let text = '';
    let thinking = '';
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
      if (delta?.reasoning_content) { thinking += delta.reasoning_content; cbs.onThinking?.(delta.reasoning_content); }
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

    if (thinking) content.push({ type: 'thinking', text: thinking });
    if (text) content.push({ type: 'text', text });
    for (const p of Object.values(pendingToolCalls)) {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(p.args || '{}'); } catch { input = { _raw: p.args }; }
      content.push({ type: 'tool_use', id: p.id ?? p.name, name: p.name, input });
    }
    if (stopReason === 'end_turn' && Object.keys(pendingToolCalls).length > 0) stopReason = 'tool_use';

    return { content, stopReason, usage: { inputTokens, outputTokens, total }, providerModel };
  }
}

// ─── Provider materialization ───────────────────────────────────────────────

export function makeOpenAiCompatibleProvider(spec: OaiCompatSpec): Provider {
  const resolveKey = spec.keyName
    ? makeKeyResolver(spec.keyName, spec.viteEnv)
    : async () => null;
  const chatUrl = `${spec.baseUrl}${spec.chatPath ?? '/chat/completions'}`;
  // Probe-filled dynamic model list; models() must be sync per the Provider
  // contract, so it reads cache-or-static.
  let dynamicModels: ModelInfo[] | null = null;

  const defaultPing = async (key: string | null): Promise<{ tier: ConnectionTier; label: string }> => {
    const res = await fetch(`${spec.baseUrl}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { tier: 'unknown', label: 'endpoint reachable' };
  };

  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    models: () => (dynamicModels?.length ? dynamicModels : spec.staticModels),

    async probe(): Promise<ProbeResult> {
      const key = await resolveKey();
      if (spec.keyName && !key) {
        return { state: 'not_detected', tier: 'unknown', label: spec.missingKeyLabel ?? `${spec.keyName} key not set` };
      }
      try {
        const { tier, label } = await (spec.ping ?? defaultPing)(key, spec.baseUrl);
        if (spec.listModels) {
          dynamicModels = await spec.listModels(key, spec.baseUrl).catch(() => null);
        }
        return { state: 'connected', tier, label };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Keyed + reachable-but-failing → 'detected'; keyless (local endpoint
        // down) → 'not_detected' so Ollama-less machines don't show a warning.
        return spec.keyName
          ? { state: 'detected', tier: 'unknown', label: 'key present but request failed', error: msg }
          : { state: 'not_detected', tier: 'unknown', label: `${spec.label} not reachable`, error: msg };
      }
    },

    async createTransport(modelId: string): Promise<AgentTransport> {
      const key = await resolveKey();
      if (spec.keyName && !key) {
        throw new Error(`${spec.label} key not found. ${spec.missingKeyLabel ?? `Set ${spec.keyName}.`}`);
      }
      return new OaiCompatTransport(spec.id, modelId, chatUrl, key, spec.headers ?? {}, spec.label);
    },
  };
}
