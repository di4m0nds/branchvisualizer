import { invoke, isTauri, listen } from '../../platform';
import { getProviderKey } from '../../providerKeys';
import type {
  AgentRequest, AgentTransport, ModelInfo, NeutralContent, NeutralMessage, NeutralResponse,
  NeutralUsage, ProbeResult, Provider, StreamCallbacks,
} from '../transport';

// Claude Code drives the local `claude` CLI as a subprocess (Rust
// `claude_code_run` → streamed NDJSON). Unlike the "Claude" provider, which
// calls the Anthropic API directly, this authenticates *as Claude Code* — so a
// `claude setup-token` OAuth token (CLAUDE_CODE_OAUTH_TOKEN) works and no
// direct-API / CORS org policy applies.
//
// ⚠️ Behavioral note: Claude Code is a *complete* agent. It runs its own tools
// (read / write / bash) inside the repo and its own loop, then reports back.
// This app's neutral `tools`, pinned-rule enforcement, and access-level gating
// do NOT wrap Claude Code's internal tool calls — it operates autonomously in
// `cwd`. We stream its output and return one `end_turn` response per turn.

// `claude --model` accepts both family aliases (resolve to the latest in that
// family — safest across CLI versions and subscription plans) and explicit
// model IDs (pinned versions, forwarded to the API). Offer both so you can pick
// a specific model; if your plan/token can't serve one, the CLI errors and we
// surface it. Aliases first as the robust default.
const MODELS: ModelInfo[] = [
  { id: 'opus',              label: 'Opus (latest)',   defaultTier: 'unknown', contextTokens: 200_000 },
  { id: 'sonnet',            label: 'Sonnet (latest)', defaultTier: 'unknown', contextTokens: 200_000 },
  { id: 'haiku',             label: 'Haiku (latest)',  defaultTier: 'unknown', contextTokens: 200_000 },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',        defaultTier: 'unknown', contextTokens: 1_000_000 },
  { id: 'claude-opus-4-7',   label: 'Opus 4.7',        defaultTier: 'unknown', contextTokens: 1_000_000 },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6',      defaultTier: 'unknown', contextTokens: 1_000_000 },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',       defaultTier: 'unknown', contextTokens: 200_000 },
];

// Edits within the repo apply without prompts (the CLI is headless and can't
// ask); other tools follow the CLI's default policy. Conservative but useful.
const PERMISSION_MODE = 'acceptEdits';

interface CliProbePayload {
  detected: boolean;
  connected: boolean;
  authKind?: string;
  version?: string;
  error?: string;
}

async function checkCli(): Promise<CliProbePayload | null> {
  if (!isTauri()) return null;
  return invoke<CliProbePayload>('check_cli_provider', { name: 'claude_code' }).catch(() => null);
}

/** Best-effort token to inject into the subprocess env. Null → the CLI falls
 *  back to whatever it finds itself (exported env var or its own login). */
async function resolveToken(): Promise<string | null> {
  const stored = await getProviderKey('claude_code');
  if (stored) return stored;
  if (isTauri()) {
    const k = await invoke<string | null>('get_provider_key', { name: 'claude_code' }).catch(() => null);
    if (k) return k;
  }
  return null;
}

function newRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `cc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Flatten the neutral transcript into a single prompt for `claude -p`. The last
 *  message already carries the session context + user text (see loop.ts). */
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

// ─── Claude Code stream-json shapes (only the fields we read) ────────────────

interface CcContentBlock { type: string; text?: string }
interface CcStreamEvent {
  type: string;                                   // 'system' | 'assistant' | 'user' | 'result'
  subtype?: string;
  message?: { content?: CcContentBlock[] };
  result?: string;
  is_error?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

interface ExitPayload { id: string; code: number | null; error: string | null }

class ClaudeCodeTransport implements AgentTransport {
  readonly id = 'claude_code';
  constructor(readonly modelId: string) {}

  async createMessage(req: AgentRequest, cbs: StreamCallbacks): Promise<NeutralResponse> {
    if (!isTauri()) throw new Error('Claude Code requires the desktop app.');

    const runId = newRunId();
    const token = await resolveToken();

    let streamed = '';           // assistant text emitted live
    let resultText = '';         // final `result` payload (fallback)
    let usage: NeutralUsage = { inputTokens: 0, outputTokens: 0, total: 0 };

    return new Promise<NeutralResponse>((resolve, reject) => {
      let unlistenData: (() => void) | null = null;
      let unlistenExit: (() => void) | null = null;
      const cleanup = () => { unlistenData?.(); unlistenExit?.(); };

      const onData = (line: string) => {
        let ev: CcStreamEvent;
        try { ev = JSON.parse(line) as CcStreamEvent; } catch { return; }

        if (ev.type === 'assistant') {
          for (const b of ev.message?.content ?? []) {
            if (b.type === 'text' && b.text) {
              streamed += b.text;
              cbs.onText?.(b.text);
            }
          }
        } else if (ev.type === 'result') {
          if (typeof ev.result === 'string') resultText = ev.result;
          if (ev.usage) {
            const u = ev.usage;
            usage = {
              inputTokens: u.input_tokens ?? 0,
              outputTokens: u.output_tokens ?? 0,
              cacheReadTokens: u.cache_read_input_tokens ?? 0,
              cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
              total: (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
                + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            };
          }
        }
      };

      const onExit = (p: ExitPayload) => {
        if (p.id !== runId) return;
        cleanup();
        const text = (streamed || resultText).trim();
        if (p.code !== 0 && !text) {
          reject(new Error(p.error?.trim() || `claude exited with code ${p.code ?? 'unknown'}`));
          return;
        }
        // If the result arrived but wasn't streamed live, surface it now so the
        // displayed message matches the returned content.
        if (!streamed && resultText) cbs.onText?.(resultText);
        const content: NeutralContent[] = [{ type: 'text', text: text || '(no output)' }];
        resolve({ content, stopReason: 'end_turn', usage, providerModel: this.modelId });
      };

      Promise.all([
        listen<string>(`claude-code://data/${runId}`, onData),
        listen<ExitPayload>('claude-code://exit', onExit),
      ])
        .then(([ud, ue]) => {
          unlistenData = ud;
          unlistenExit = ue;
          return invoke<void>('claude_code_run', {
            id: runId,
            prompt: toPrompt(req.messages),
            cwd: req.cwd ?? '.',
            model: this.modelId,
            permissionMode: PERMISSION_MODE,
            oauthToken: token,
          });
        })
        .catch((e) => {
          cleanup();
          reject(e instanceof Error ? e : new Error(String(e)));
        });
    });
  }
}

export const claudeCodeProvider: Provider = {
  id: 'claude_code',
  label: 'Claude Code',
  description: 'Claude via the local `claude` CLI — works with a Claude Code OAuth token.',
  models: () => MODELS,

  async probe(): Promise<ProbeResult> {
    if (!isTauri()) {
      return { state: 'not_detected', tier: 'unknown', label: 'requires the desktop app' };
    }
    const cli = await checkCli();
    if (cli?.connected) {
      const isOauth = cli.authKind === 'oauth';
      return {
        state: 'connected',
        tier: isOauth ? 'free' : 'paid',
        label: `claude CLI · ${isOauth ? 'OAuth token' : cli.authKind ?? 'authenticated'}`,
        version: cli.version,
      };
    }
    if (cli?.detected) {
      return {
        state: 'detected',
        tier: 'unknown',
        label: 'claude CLI present but not authenticated (run `claude` or set CLAUDE_CODE_OAUTH_TOKEN)',
        version: cli.version,
        error: cli.error,
      };
    }
    return { state: 'not_detected', tier: 'unknown', label: '`claude` CLI not on PATH' };
  },

  async createTransport(modelId: string): Promise<AgentTransport> {
    if (!isTauri()) throw new Error('Claude Code requires the desktop app.');
    return new ClaudeCodeTransport(modelId);
  },
};
