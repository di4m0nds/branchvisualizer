import OpenAI from 'openai';
import { invoke, isTauri } from '../../platform';
import type {
  AgentRequest, AgentTransport, ModelInfo, NeutralContent, NeutralMessage, NeutralResponse,
  NeutralStopReason, NeutralUsage, ProbeResult, Provider, StreamCallbacks,
} from '../transport';

// OpenAI Codex CLI wraps ChatGPT-plan or API-key auth. Detection order:
//   1) Rust `check_cli_provider("codex")` — reads `codex auth status` + auth.json
//   2) OPENAI_API_KEY env var
// If a ChatGPT-plan token is present the CLI still exposes an API-compatible key
// via `codex auth token`, which we surface through `get_provider_key`.

const MODELS: ModelInfo[] = [
  { id: 'gpt-5-codex',      label: 'GPT-5 Codex',    defaultTier: 'paid', contextTokens: 400_000 },
  { id: 'gpt-5.1-codex',    label: 'GPT-5.1 Codex',  defaultTier: 'paid', contextTokens: 400_000 },
  { id: 'gpt-4.1',          label: 'GPT-4.1',        defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'o4-mini',          label: 'o4-mini',        defaultTier: 'paid', contextTokens: 200_000 },
];

interface CliProbePayload {
  detected: boolean;
  connected: boolean;
  authKind?: string;    // 'oauth' | 'apikey' | ...
  version?: string;
  error?: string;
}

async function checkCli(): Promise<CliProbePayload | null> {
  if (!isTauri()) return null;
  return invoke<CliProbePayload>('check_cli_provider', { name: 'codex' }).catch(() => null);
}

async function resolveKey(): Promise<string | null> {
  if (isTauri()) {
    const k = await invoke<string | null>('get_provider_key', { name: 'openai' }).catch(() => null);
    if (k) return k;
  }
  return import.meta.env.VITE_OPENAI_API_KEY ?? null;
}

// ─── Adapters ─────────────────────────────────────────────────────────────

interface OaiTextItem { type: 'text'; text: string }
interface OaiFuncCall { type: 'function_call'; call_id: string; name: string; arguments: string }
interface OaiFuncCallOut { type: 'function_call_output'; call_id: string; output: string }
type OaiInputItem =
  | { role: 'user' | 'assistant' | 'system'; content: OaiTextItem[] | string }
  | OaiFuncCall
  | OaiFuncCallOut;

function toOpenAIInput(system: string, msgs: NeutralMessage[]): OaiInputItem[] {
  const items: OaiInputItem[] = [{ role: 'system', content: [{ type: 'text', text: system }] }];
  for (const m of msgs) {
    for (const c of m.content) {
      switch (c.type) {
        case 'text':
          if (c.text) items.push({ role: m.role, content: [{ type: 'text', text: c.text }] });
          break;
        case 'tool_use':
          items.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.input) });
          break;
        case 'tool_result':
          items.push({ type: 'function_call_output', call_id: c.toolUseId, output: c.content });
          break;
        case 'thinking':
          // Not part of the request surface; the model regenerates reasoning per turn.
          break;
      }
    }
  }
  return items;
}

class CodexTransport implements AgentTransport {
  readonly id = 'openai_codex';
  constructor(readonly modelId: string, private client: OpenAI) {}

  async createMessage(req: AgentRequest, cbs: StreamCallbacks): Promise<NeutralResponse> {
    const input = toOpenAIInput(req.system, req.messages);
    const tools = req.tools.map((t) => ({
      type: 'function' as const,
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      strict: false,
    }));

    const params = {
      model: this.modelId,
      input,
      tools,
      max_output_tokens: req.maxTokens,
      reasoning: { effort: req.effort === 'max' ? 'high' : req.effort },
      stream: true,
    };

    // The Responses API surface may drift; treat the stream as an event iterator.
    // We only need incremental text deltas + the final aggregated response.
    const stream = await this.client.responses.stream(params as unknown as Parameters<OpenAI['responses']['stream']>[0]);

    for await (const ev of stream as AsyncIterable<{ type: string; delta?: string }>) {
      if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') {
        cbs.onText?.(ev.delta);
      } else if (ev.type === 'response.reasoning_summary_text.delta' && typeof ev.delta === 'string') {
        cbs.onThinking?.(ev.delta);
      }
    }

    const final = await stream.finalResponse() as unknown as {
      output?: Array<{ type: string; content?: Array<{ type: string; text?: string }>; call_id?: string; name?: string; arguments?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
      model?: string;
      status?: string;
    };

    const content: NeutralContent[] = [];
    let sawToolCall = false;
    for (const item of final.output ?? []) {
      if (item.type === 'message') {
        const text = (item.content ?? []).filter((p) => p.type === 'output_text').map((p) => p.text ?? '').join('');
        if (text) content.push({ type: 'text', text });
      } else if (item.type === 'function_call') {
        sawToolCall = true;
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(item.arguments ?? '{}'); } catch { input = { _raw: item.arguments ?? '' }; }
        content.push({ type: 'tool_use', id: item.call_id ?? crypto.randomUUID?.() ?? String(Math.random()), name: item.name ?? '', input });
      }
    }

    const usage: NeutralUsage = {
      inputTokens: final.usage?.input_tokens ?? 0,
      outputTokens: final.usage?.output_tokens ?? 0,
      total: final.usage?.total_tokens ?? ((final.usage?.input_tokens ?? 0) + (final.usage?.output_tokens ?? 0)),
    };

    const stopReason: NeutralStopReason = sawToolCall ? 'tool_use' : 'end_turn';
    return { content, stopReason, usage, providerModel: final.model ?? this.modelId };
  }
}

export const openaiCodexProvider: Provider = {
  id: 'openai_codex',
  label: 'OpenAI Codex',
  description: 'OpenAI Codex — CLI-authed (~/.codex) or OPENAI_API_KEY.',
  models: () => MODELS,

  async probe(): Promise<ProbeResult> {
    const cli = await checkCli();
    if (cli?.connected) {
      const authLabel = cli.authKind === 'oauth' ? 'ChatGPT plan (OAuth)' : cli.authKind ?? 'API key';
      return {
        state: 'connected',
        tier: cli.authKind === 'oauth' ? 'paid' : 'paid',
        label: `codex CLI · ${authLabel}`,
        version: cli.version,
      };
    }
    if (cli?.detected) {
      return {
        state: 'detected',
        tier: 'unknown',
        label: 'codex CLI present but not authenticated (run `codex login`)',
        version: cli.version,
        error: cli.error,
      };
    }
    const key = await resolveKey();
    if (key) return { state: 'connected', tier: 'paid', label: 'OPENAI_API_KEY set' };
    return { state: 'not_detected', tier: 'unknown', label: 'no codex CLI, no OPENAI_API_KEY' };
  },

  async createTransport(modelId: string): Promise<AgentTransport> {
    const key = await resolveKey();
    if (!key) throw new Error('OpenAI key not available. Run `codex login` or set OPENAI_API_KEY.');
    return new CodexTransport(modelId, new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true }));
  },
};
