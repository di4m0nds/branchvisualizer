import { invoke, isTauri, listen } from '../../platform';
import { getPrompt, renderPrompt } from '../prompts';
import { getProviderKey } from '../../providerKeys';
import type { SkillFlag } from '@/types/session';
import type {
  AgentRequest, AgentTransport, ContextSizeId, ModelInfo, NeutralContent, NeutralMessage, NeutralResponse,
  NeutralUsage, ProbeResult, Provider, StreamCallbacks,
} from '../transport';
import { STD_ONLY, STD_OR_1M } from './claudeModels';

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
// contextTokens is the STANDARD size; 1M lives in contextOptions and is opted
// into via the `[1m]` model-string suffix (see ClaudeCodeTransport.cliModel).
// On a subscription plan, 1M requires usage credits — standard always works.
// Only Sonnet 4.x exposes the 1M-context beta; Opus and Haiku serve 200K only.
// Offering 1M where the model can't serve it produced the "Usage credits
// required for 1M context" CLI error, so the option is gated to Sonnet here.
const MODELS: ModelInfo[] = [
  { id: 'opus',              label: 'Opus (latest)',   defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_ONLY },
  { id: 'sonnet',            label: 'Sonnet (latest)', defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_OR_1M },
  { id: 'haiku',             label: 'Haiku (latest)',  defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_ONLY },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',        defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_ONLY },
  { id: 'claude-opus-4-7',   label: 'Opus 4.7',        defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_ONLY },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6',      defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_OR_1M },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',       defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_ONLY },
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

/** Compact, purpose-built system prompt appended to the CLI's own baked-in
 *  prompt via `--append-system-prompt`. Scoped strictly to the rendering
 *  conventions the IDE relies on — NO fake persona, NO session_context, NO
 *  pinned_rules. Trying to inject the full BASE_SYSTEM_PROMPT into the user
 *  turn triggered Claude's prompt-injection guard and the model rejected the
 *  framing. The `--append-system-prompt` channel is the sanctioned route.
 *  Trimmed intentionally: the CLI already knows how to be a code agent — we
 *  only teach it the extra XML blocks the IDE renders. */
/** The IDE rendering contract for the claude CLI, read through the prompt
 *  registry (Settings → Prompts can override it). See prompts.ts for the text. */
export function claudeCodeAppendPrompt(): string {
  return getPrompt('cc_append_prompt');
}

/** Build the CLI-appended prompt with the session's enabled skill flags and
 *  access-level guidance mixed in. Called per turn so toggling a skill or
 *  access level in the config strip takes effect on the very next request. */
export function buildAppendPrompt(skills: SkillFlag[] = [], accessLevel?: string, buildMode?: string, kbPath?: string): string {
  const enabled = skills
    .filter((s) => s.enabled)
    .map((s) => getPrompt(`cc_skill.${s.id}`))
    .filter(Boolean);

  let prompt = claudeCodeAppendPrompt();
  if (enabled.length > 0) {
    prompt += `\n\n**Session behaviors (enabled by the user — honour throughout the turn).**\n${enabled.map((line) => `- ${line}`).join('\n')}\n`;
  }
  // Planning gates edits regardless of access level, so its clause wins; the
  // supervised "no shell" guidance is redundant in a read-only planning turn.
  if (buildMode === 'planning') {
    prompt += getPrompt('cc_planning_clause');
  } else if (accessLevel === 'supervised') {
    prompt += getPrompt('cc_supervised_clause');
  }
  // Local projects: the knowledge base is real files in the working tree — the
  // CLI's own Read/Grep tools can consult it directly.
  if (kbPath) {
    prompt += renderPrompt('cc_kb_pointer', { path: kbPath });
  }
  return prompt;
}

/** Flatten the neutral transcript into a single prompt for `claude -p`. The
 *  system prompt now reaches the CLI via `--append-system-prompt` (see
 *  `CLAUDE_CODE_APPEND_PROMPT` above), so stdin carries the raw user turn(s)
 *  and nothing else. */
function toPrompt(msgs: NeutralMessage[]): string {
  const textOf = (c: NeutralContent[]): string =>
    c.map((b) => (b.type === 'text' ? b.text : '')).filter(Boolean).join('\n').trim();
  // The CLI runs locally and reads files itself — attachments travel as
  // absolute paths appended to the turn, not as bytes.
  const withAttachments = (m: NeutralMessage, t: string): string => {
    const paths = (m.attachments ?? []).map((a) => a.path).filter(Boolean) as string[];
    if (m.role !== 'user' || paths.length === 0) return t;
    return `${t}\n\nAttached files (read them for context):\n${paths.map((p) => `- ${p}`).join('\n')}`;
  };

  if (msgs.length <= 1) {
    const m = msgs[0];
    return m ? withAttachments(m, textOf(m.content)) : '';
  }
  return msgs
    .map((m) => {
      const t = textOf(m.content);
      if (!t) return '';
      return `${m.role === 'user' ? 'User' : 'Assistant'}: ${withAttachments(m, t)}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

// ─── Claude Code stream-json shapes (only the fields we read) ────────────────

interface CcContentBlock {
  type: string;                                   // 'text' | 'thinking' | 'tool_use' | 'tool_result'
  text?: string;
  thinking?: string;
  // tool_use
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}
interface CcStreamEvent {
  type: string;                                   // 'system' | 'assistant' | 'user' | 'result'
  subtype?: string;
  model?: string;                                 // 'system'/init event carries the served model
  message?: { content?: CcContentBlock[]; model?: string };
  result?: string;
  is_error?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

// ─── Action-log synthesis ────────────────────────────────────────────────────
// Convert the CLI's internal tool_use / tool_result events into `<action_log>`
// XML fragments streamed through `onText`. The tolerant parser in
// `components/agent/blocks.ts` picks them up as `action_log` blocks and the
// timeline/Verbose surfaces them exactly like the app's own tool calls.

const OUTPUT_CAP = 500;
const INPUT_CAP = 240;

// ─── Compound-Bash approval parsing ─────────────────────────────────────────
// When the Claude Code CLI rejects a chained command it emits
// "The following parts require approval: cat FOO, echo BAR". Extract those
// sub-commands so the approval card shows each part on its own row instead of
// hiding them behind the compound blob.

/** Extract the sub-commands the CLI itself named after "…require approval: …". */
export function extractApprovalParts(errorText: string): string[] {
  const m = errorText.match(/(?:following parts?|these parts?)[^:]*:\s*([\s\S]+?)(?:\.\s|\.$|$)/i);
  if (!m) return [];
  return m[1].split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
}

/** Split a compound shell command on top-level `&&`, `||`, `;`, `|` — leaving
 *  operators inside single/double quotes untouched. Fallback when the CLI's
 *  error text doesn't spell out the offending parts. */
export function splitCompound(cmd: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    // Bare `\` escape — keep the next char inside the current buffer.
    if (c === '\\' && i + 1 < cmd.length) {
      buf += c + cmd[i + 1];
      i += 2;
      continue;
    }
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      i += 1;
      continue;
    }
    // Two-char operators first.
    if ((c === '&' && cmd[i + 1] === '&') || (c === '|' && cmd[i + 1] === '|')) {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
      i += 2;
      continue;
    }
    if (c === ';' || c === '|') {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shortInputSummary(input?: Record<string, unknown>): string {
  if (!input) return '';
  // Common Claude Code tool input shapes: file_path, pattern, command, path, url…
  const keys = ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'notebook_path'];
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v) return v.slice(0, INPUT_CAP);
  }
  const s = JSON.stringify(input);
  return s.length > INPUT_CAP ? `${s.slice(0, INPUT_CAP)}…` : s;
}

function toolResultText(content?: string | Array<{ type: string; text?: string }>): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content.map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('\n');
}

function synthToolUseXml(name: string, input?: Record<string, unknown>): string {
  const desc = shortInputSummary(input);
  return `\n<action_log tool="${esc(name)}">`
    + `<description>${esc(desc || name)}</description>`
    + `<status>running</status>`
    + `<output>${esc(desc)}</output>`
    + `</action_log>\n`;
}

function synthToolResultXml(name: string, output: string, isError: boolean): string {
  const trimmed = output.length > OUTPUT_CAP ? `${output.slice(0, OUTPUT_CAP)}…` : output;
  return `\n<action_log tool="${esc(name)}">`
    + `<description>${esc(name)} — ${isError ? 'failed' : 'complete'}</description>`
    + `<status>${isError ? 'error' : 'complete'}</status>`
    + `<output>${esc(trimmed)}</output>`
    + `</action_log>\n`;
}

interface ExitPayload { id: string; code: number | null; error: string | null }

/** The CLI's error when a subscription plan can't serve a 1M-context request.
 *  Loose match: catches both the "Usage credits required for 1M context" and
 *  the "--model to switch to standard context" phrasings. */
export function is1mCreditError(text: string): boolean {
  if (!text) return false;
  return /usage credits required for 1m context/i.test(text)
    || /--model to switch to standard context/i.test(text);
}

/** Thrown when a 1M-context turn fails purely because the plan lacks the
 *  credits to serve it. The loop catches this (by `code`) and transparently
 *  retries the same turn on the standard 200K window. */
export class Context1mUnavailableError extends Error {
  readonly code = 'context_1m_unavailable';
  constructor(message = '1M context is not available on this plan') {
    super(message);
    this.name = 'Context1mUnavailableError';
  }
}

class ClaudeCodeTransport implements AgentTransport {
  readonly id = 'claude_code';
  constructor(readonly modelId: string, readonly contextSize: ContextSizeId = 'standard') {}

  /** The string passed to `claude --model`. Appends the `[1m]` suffix to opt
   *  into the 1M-context beta; without it the CLI uses standard context. The
   *  base `modelId` (no suffix) stays the display/dedup key. */
  private cliModel(): string {
    return this.contextSize === '1m' ? `${this.modelId}[1m]` : this.modelId;
  }

  async createMessage(req: AgentRequest, cbs: StreamCallbacks): Promise<NeutralResponse> {
    if (!isTauri()) throw new Error('Claude Code requires the desktop app.');

    const runId = newRunId();
    const token = await resolveToken();

    let streamed = '';           // assistant text emitted live
    let resultText = '';         // final `result` payload (fallback)
    let servedModel = '';        // model the CLI actually ran (from system/assistant events)
    let usage: NeutralUsage = { inputTokens: 0, outputTokens: 0, total: 0 };
    // Track the CLI's tool_use id → tool name so we can label the matching
    // tool_result when it arrives on the next NDJSON user event.
    const toolNames = new Map<string, string>();
    // Track tool_use id → the actual command / file / input summary the CLI
    // was trying to run so a denied tool_result can name it in the approval
    // card the user sees when the CLI needs permissions.
    const toolInputs = new Map<string, string>();
    // Compound commands that came back with "requires approval". Each entry
    // is `{ full, parts }` — `parts` is what the CLI actually flagged (either
    // extracted from its error text, or a conservative shell split as a
    // fallback). Deduped by `full`.
    const approvalEntries = new Map<string, string[]>();
    // Set once we kill the subprocess to freeze the turn for approval, so we
    // don't fire the kill repeatedly for each subsequent denied command.
    let killedForApproval = false;
    // Set when the CLI reports it can't serve the requested 1M context on this
    // plan. onExit turns this into a typed rejection the loop retries on 200K,
    // instead of dumping the raw credit error into the transcript.
    let creditError1m = false;
    // Fired the FIRST time an approval failure is detected so the card is
    // visible while the CLI is still running (in case the user hits Stop) as
    // well as when the CLI exits normally. Later approval failures are still
    // tracked so the timeline shows them, but only the first emission goes
    // through — the card only needs to appear once.
    let approvalCardEmitted = false;
    const emitApprovalCardOnce = () => {
      if (approvalCardEmitted || approvalEntries.size === 0) return;
      approvalCardEmitted = true;
      // Each compound → one row per sub-command, carrying the full compound as
      // an attribute so the card can show it in a tooltip / copy-all button.
      const cmds: string[] = [];
      for (const [full, parts] of approvalEntries) {
        const rows = parts.length > 0 ? parts : [full];
        for (const p of rows) {
          cmds.push(`<cmd full="${esc(full)}">${esc(p)}</cmd>`);
        }
      }
      const xml = `\n<cli_approval_needed>`
        + `<reason>The agent needs permission to run commands in this repo.</reason>`
        + `<commands>${cmds.join('')}</commands>`
        + `</cli_approval_needed>\n`;
      streamed += xml;
      cbs.onText?.(xml);
    };

    return new Promise<NeutralResponse>((resolve, reject) => {
      let unlistenData: (() => void) | null = null;
      let unlistenExit: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;
      const cleanup = () => {
        unlistenData?.();
        unlistenExit?.();
        if (abortHandler) req.signal?.removeEventListener('abort', abortHandler);
      };

      // Kill the subprocess when the caller aborts (Stop button). Best-effort:
      // the CLI may emit one or two more NDJSON lines before it dies, which
      // the reader treats as noise; the reject below wins.
      const abort = () => {
        invoke<void>('claude_code_kill', { id: runId }).catch(() => {});
        // If the CLI reported approval failures before the user hit Stop,
        // make sure the approval card surfaces so they have something to act
        // on when the turn finalizes.
        emitApprovalCardOnce();
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (req.signal) {
        if (req.signal.aborted) { abort(); return; }
        abortHandler = abort;
        req.signal.addEventListener('abort', abortHandler, { once: true });
      }

      const onData = (line: string) => {
        let ev: CcStreamEvent;
        try { ev = JSON.parse(line) as CcStreamEvent; } catch { return; }

        // Capture the model the CLI actually resolved to, so the UI can show it
        // (a `sonnet` alias resolves to a concrete `claude-sonnet-4-6…`). The
        // init event is `type: 'system'` with a top-level `model`; assistant
        // events also carry `message.model` as a fallback.
        if (ev.model) servedModel = ev.model;
        if (ev.message?.model) servedModel = ev.message.model;
        if (ev.type === 'system') return;

        if (ev.type === 'assistant') {
          for (const b of ev.message?.content ?? []) {
            if (b.type === 'text' && b.text) {
              streamed += b.text;
              cbs.onText?.(b.text);
            } else if (b.type === 'thinking' && b.thinking) {
              cbs.onThinking?.(b.thinking);
            } else if (b.type === 'tool_use' && b.id && b.name) {
              toolNames.set(b.id, b.name);
              toolInputs.set(b.id, shortInputSummary(b.input) || b.name);
              const xml = synthToolUseXml(b.name, b.input);
              streamed += xml;
              cbs.onText?.(xml);
            }
          }
        } else if (ev.type === 'user') {
          // CLI reports its own tool_result back inside a synthetic user turn.
          for (const b of ev.message?.content ?? []) {
            if (b.type === 'tool_result' && b.tool_use_id) {
              const name = toolNames.get(b.tool_use_id) ?? 'tool';
              const out = toolResultText(b.content);
              const isErr = Boolean(b.is_error);
              // Detect the CLI's "requires approval" refusal so we can surface
              // a single approval card the user can act on instead of a stream
              // of failed action_logs. Widened regex catches both "requires
              // approval" (singular) and "require approval" (plural verb the
              // CLI uses when reporting multiple offending sub-commands).
              if (isErr && /require[sd]? approval/i.test(out)) {
                const cmd = toolInputs.get(b.tool_use_id) || name;
                if (cmd && !approvalEntries.has(cmd)) {
                  // Prefer the sub-commands the CLI itself named; fall back to
                  // a conservative shell-aware split of the compound.
                  const named = extractApprovalParts(out);
                  const parts = named.length > 0 ? named : splitCompound(cmd);
                  // A single-part "split" carries no signal — collapse to [].
                  approvalEntries.set(cmd, parts.length > 1 ? parts : []);
                }
                // Fire immediately on the first hit — waiting for onExit
                // means the card never appears if the user hits Stop.
                emitApprovalCardOnce();
                // FREEZE: kill the CLI on the first approval-needed so it can't
                // spin through more failed commands. The turn ends here with
                // the approval card; approving re-runs with bypassPermissions.
                // Skip when we're already bypassing (that path never needs
                // approval, so a match would be spurious).
                if (req.permissionMode !== 'bypassPermissions' && !killedForApproval) {
                  killedForApproval = true;
                  invoke<void>('claude_code_kill', { id: runId }).catch(() => {});
                }
              }
              const xml = synthToolResultXml(name, out, isErr);
              streamed += xml;
              cbs.onText?.(xml);
            }
          }
        } else if (ev.type === 'result') {
          if (typeof ev.result === 'string') resultText = ev.result;
          if (this.contextSize === '1m' && ev.is_error && is1mCreditError(ev.result ?? '')) {
            creditError1m = true;
          }
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
        // 1M-context credit failure: reject with a typed error so the loop can
        // transparently retry on the standard window. Keep the raw CLI credit
        // message out of the transcript entirely.
        if (this.contextSize === '1m'
            && (creditError1m || is1mCreditError(resultText || streamed || p.error || ''))) {
          reject(new Context1mUnavailableError());
          return;
        }
        const text = (streamed || resultText).trim();
        if (p.code !== 0 && !text) {
          reject(new Error(p.error?.trim() || `claude exited with code ${p.code ?? 'unknown'}`));
          return;
        }
        // If the result arrived but wasn't streamed live, surface it now so the
        // displayed message matches the returned content.
        if (!streamed && resultText) cbs.onText?.(resultText);
        // Safety net: if approvals came in but were somehow not fired mid-stream
        // (edge cases only — normally the immediate-fire path handles this).
        emitApprovalCardOnce();
        const finalText = (streamed || resultText).trim();
        const content: NeutralContent[] = [{ type: 'text', text: finalText || '(no output)' }];
        resolve({ content, stopReason: 'end_turn', usage, providerModel: servedModel || this.cliModel() || this.modelId });
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
            model: this.cliModel(),
            permissionMode: req.permissionMode ?? PERMISSION_MODE,
            oauthToken: token,
            // Loop passes a skill-aware prompt via `req.appendSystem`; fall
            // back to the plain base if the field is unset (older callers).
            appendSystem: req.appendSystem ?? claudeCodeAppendPrompt(),
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

  async createTransport(modelId: string, context: ContextSizeId = 'standard'): Promise<AgentTransport> {
    if (!isTauri()) throw new Error('Claude Code requires the desktop app.');
    return new ClaudeCodeTransport(modelId, context);
  },
};
