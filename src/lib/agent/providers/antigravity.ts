import { invoke, isTauri, listen } from '../../platform';
import { getProviderKey } from '../../providerKeys';
import type {
  AgentRequest, AgentTransport, ContextSizeId, ModelInfo, NeutralContent, NeutralMessage,
  NeutralResponse, NeutralUsage, ProbeResult, Provider, StreamCallbacks,
} from '../transport';

// Google Antigravity provider — Gemini via the Python `google-antigravity` SDK.
// Antigravity is a *complete* agent framework (its own loop / tools / MCP), so
// it's driven as a headless Python subprocess through the Rust `antigravity_run`
// bridge (see src-tauri/src/antigravity.rs), NOT as a thin model client like the
// `gemini` provider. The app's neutral tools / pinned-rule enforcement do not
// wrap Antigravity's internal tool calls — it operates autonomously in `cwd`.
// We stream its output and return one `end_turn` response per turn.

const MODELS: ModelInfo[] = [
  { id: 'gemini-3.5-flash',       label: 'Gemini 3.5 Flash',      defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro',        defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'gemini-3.1-flash-lite',  label: 'Gemini 3.1 Flash-Lite', defaultTier: 'free', contextTokens: 1_000_000 },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash',        defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro',        defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash',      defaultTier: 'free', contextTokens: 1_000_000 },
  { id: 'gemini-2.5-flash-lite',  label: 'Gemini 2.5 Flash-Lite', defaultTier: 'free', contextTokens: 1_000_000 },
];

interface AgProbePayload {
  detected: boolean;
  version?: string;
  python?: string;
  error?: string;
}

async function checkSdk(): Promise<AgProbePayload | null> {
  if (!isTauri()) return null;
  return invoke<AgProbePayload>('antigravity_check').catch(() => null);
}

/** Resolve a Gemini Developer API key. Antigravity runs on google-genai, so it
 *  reuses the Gemini key — try a dedicated `antigravity` key first, then the
 *  shared `gemini` one, then the env fallbacks. */
async function resolveKey(): Promise<string | null> {
  const stored = (await getProviderKey('antigravity')) || (await getProviderKey('gemini'));
  if (stored) return stored;
  if (isTauri()) {
    const k = await invoke<string | null>('get_provider_key', { name: 'antigravity' }).catch(() => null);
    if (k) return k;
  }
  return import.meta.env.VITE_GEMINI_API_KEY ?? null;
}

function newRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ag-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Flatten the neutral message history into a single prompt. Each Antigravity
// turn spawns a fresh agent (no conversation_id), so we pass the full history.
function toPrompt(msgs: NeutralMessage[]): string {
  const textOf = (c: NeutralContent[]): string =>
    c.map((b) => (b.type === 'text' ? b.text : '')).filter(Boolean).join('\n').trim();
  if (msgs.length <= 1) return textOf(msgs[0]?.content ?? []);
  return msgs
    .map((m) => {
      const t = textOf(m.content);
      if (!t) return '';
      return `${m.role === 'user' ? 'User' : 'Assistant'}: ${t}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Surface an agent tool invocation as an <action_log> so the Verbose timeline
// renders it like the app's own tool calls (the tolerant parser in blocks.ts).
function synthToolLog(name: string): string {
  return `\n<action_log tool="${esc(name)}">`
    + `<description>${esc(name)}</description>`
    + `<status>complete</status>`
    + `<output></output>`
    + `</action_log>\n`;
}

interface AgStreamEvent {
  type: string;                                   // 'text' | 'tool_call' | 'result' | 'error'
  text?: string;
  name?: string;
  model?: string;
  usage?: { input?: number; output?: number; total?: number };
  error?: string;
}

interface ExitPayload { id: string; code: number | null; error: string | null }

class AntigravityTransport implements AgentTransport {
  readonly id = 'antigravity';
  constructor(readonly modelId: string, private apiKey: string | null, readonly contextSize: ContextSizeId = 'standard') {}

  async createMessage(req: AgentRequest, cbs: StreamCallbacks): Promise<NeutralResponse> {
    if (!isTauri()) throw new Error('Antigravity requires the desktop app.');

    const runId = newRunId();
    let streamed = '';
    let servedModel = this.modelId;
    let bridgeError = '';
    let usage: NeutralUsage = { inputTokens: 0, outputTokens: 0, total: 0 };

    return new Promise<NeutralResponse>((resolve, reject) => {
      let unlistenData: (() => void) | null = null;
      let unlistenExit: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;
      const cleanup = () => {
        unlistenData?.();
        unlistenExit?.();
        if (abortHandler) req.signal?.removeEventListener('abort', abortHandler);
      };

      const abort = () => {
        invoke<void>('antigravity_kill', { id: runId }).catch(() => {});
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (req.signal) {
        if (req.signal.aborted) { abort(); return; }
        abortHandler = abort;
        req.signal.addEventListener('abort', abortHandler, { once: true });
      }

      const onData = (line: string) => {
        let ev: AgStreamEvent;
        try { ev = JSON.parse(line) as AgStreamEvent; } catch { return; }
        switch (ev.type) {
          case 'text':
            if (ev.text) { streamed += ev.text; cbs.onText?.(ev.text); }
            break;
          case 'tool_call':
            if (ev.name) { const xml = synthToolLog(ev.name); streamed += xml; cbs.onText?.(xml); }
            break;
          case 'result':
            if (ev.model) servedModel = ev.model;
            if (ev.usage) {
              const input = ev.usage.input ?? 0;
              const output = ev.usage.output ?? 0;
              usage = { inputTokens: input, outputTokens: output, total: ev.usage.total ?? (input + output) };
            }
            break;
          case 'error':
            if (ev.error) bridgeError = ev.error;
            break;
        }
      };

      const onExit = (p: ExitPayload) => {
        if (p.id !== runId) return;
        cleanup();
        const text = streamed.trim();
        if (!text) {
          const msg = bridgeError || p.error?.trim() || `antigravity bridge exited with code ${p.code ?? 'unknown'}`;
          reject(new Error(msg));
          return;
        }
        const content: NeutralContent[] = [{ type: 'text', text }];
        resolve({ content, stopReason: 'end_turn', usage, providerModel: servedModel });
      };

      Promise.all([
        listen<string>(`antigravity://data/${runId}`, onData),
        listen<ExitPayload>('antigravity://exit', onExit),
      ])
        .then(([ud, ue]) => {
          unlistenData = ud;
          unlistenExit = ue;
          return invoke<void>('antigravity_run', {
            id: runId,
            prompt: toPrompt(req.messages),
            cwd: req.cwd ?? '.',
            model: this.modelId,
            // The IDE rendering conventions (+ skill flags) live in appendSystem;
            // fall back to the base system prompt.
            system: req.appendSystem ?? req.system,
            apiKey: this.apiKey,
          });
        })
        .catch((e) => {
          cleanup();
          reject(e instanceof Error ? e : new Error(String(e)));
        });
    });
  }
}

export const antigravityProvider: Provider = {
  id: 'antigravity',
  label: 'Antigravity',
  description: 'Google Antigravity SDK — Gemini agents via the local Python runtime.',
  models: () => MODELS,

  async probe(): Promise<ProbeResult> {
    if (!isTauri()) {
      return { state: 'not_detected', tier: 'unknown', label: 'requires the desktop app' };
    }
    const sdk = await checkSdk();
    if (!sdk?.detected) {
      return {
        state: 'not_detected',
        tier: 'unknown',
        label: sdk?.error ? `SDK not found — ${sdk.error}` : 'google-antigravity not installed (pip install google-antigravity)',
        error: sdk?.error,
      };
    }
    const key = await resolveKey();
    if (!key) {
      return {
        state: 'detected',
        tier: 'unknown',
        label: `SDK v${sdk.version ?? '?'} · needs a Gemini API key`,
        version: sdk.version,
      };
    }
    return {
      state: 'connected',
      tier: 'unknown',
      label: `SDK v${sdk.version ?? '?'} · key ok`,
      version: sdk.version,
    };
  },

  async createTransport(modelId: string, _context?: ContextSizeId): Promise<AgentTransport> {
    if (!isTauri()) throw new Error('Antigravity requires the desktop app.');
    const key = await resolveKey();
    // Not fatal — the SDK may pick up GEMINI_API_KEY/GOOGLE_API_KEY from the env
    // itself. Pass what we have; the bridge surfaces an auth error if it can't.
    return new AntigravityTransport(modelId, key);
  },
};
