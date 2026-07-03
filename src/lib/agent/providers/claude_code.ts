import { invoke, isTauri, listen } from '../../platform';
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
const MODELS: ModelInfo[] = [
  { id: 'opus',              label: 'Opus (latest)',   defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_OR_1M },
  { id: 'sonnet',            label: 'Sonnet (latest)', defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_OR_1M },
  { id: 'haiku',             label: 'Haiku (latest)',  defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_ONLY },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',        defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_OR_1M },
  { id: 'claude-opus-4-7',   label: 'Opus 4.7',        defaultTier: 'unknown', contextTokens: 200_000, contextOptions: STD_OR_1M },
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
export const CLAUDE_CODE_APPEND_PROMPT = `You are running inside an IDE that renders your responses. Follow these output conventions in every turn — they are the IDE's contract for how it interprets your text.

**Reasoning.** For any non-trivial decision, emit a \`<thinking>…</thinking>\` block with a concise walk-through of constraints, tradeoffs, and the choice. The IDE surfaces it as a collapsible "Thought process" step (visible to the user, not hidden).

**Clarifying questions — MUST be XML.** When you need input from the user to proceed — including any request phrased as "multiple choice", "give me options", "which should I do first — A/B/C?", or any lettered/numbered pick-list — you MUST emit a \`<questions_for_user>\` XML block. NEVER write choices as a Markdown "A. …/B. …/C. …" list in prose. The IDE only renders the interactive popup for the XML form; a Markdown list will appear as inert chat text and defeat the entire flow. Format:

\`\`\`
<questions_for_user>
  <question id="q1" multi="false">
    <text>Which should I tackle first?</text>
    <choice id="c1" description="1–2 sentence 'deep but short' explanation of what picking this means.">Option label</choice>
    <choice id="c2" description="Similar explanation for this option.">Another option</choice>
  </question>
</questions_for_user>
\`\`\`

Every \`<choice>\` MUST include a \`description="…"\` attribute (1–2 sentences) — the popup has real room to render it and choices without a description look bare.

**Hard stop after questions.** After emitting \`<questions_for_user>\`, STOP your response immediately. Do NOT run any tools, do NOT continue reasoning, do NOT emit any other content in the same turn. The user's answer will arrive as the next turn and you resume then. Continuing past the block wastes tokens and produces work the user has not yet approved.

**Planning mode.** When the session is in planning mode, lead with a \`<plan>…</plan>\` block outlining the concrete steps, and, if any scope decision is the user's to make, ask via \`<questions_for_user>\` before touching any files. Do not edit or create files — read-only investigation only — until the user approves the plan (the IDE tells you when you are in planning mode; see the injected clause).

**Prose formatting.** In conversational prose (outside structured XML blocks), lightweight Markdown is allowed: \`**bold**\`, \`*italic*\`, \`\`\`inline code\`\`\`, and fenced \`\`\`lang code blocks. NO headings, tables, images, or blockquotes. Structured blocks stay XML — never wrap them in Markdown.

**Task summary footer.** For any **non-trivial turn** — a multi-file change, a bug fix, a new feature, a substantial refactor — end your response with a \`<task_summary>\` block using this schema:

\`\`\`
<task_summary>
  <what_was_done>1–3 sentence overview of what you did.</what_was_done>
  <files>
    <file path="src/foo.ts" change="modified">One-line summary of the change.</file>
    <file path="src/bar.ts" change="added">One-line summary.</file>
  </files>
  <root_cause>Only for bug fixes: what was wrong and why.</root_cause>
  <features>Only for new features: brief bullets or prose.</features>
  <verification>
    <command>pnpm test</command>
    <command>pnpm typecheck</command>
  </verification>
  <notes>Optional caveats or follow-ups.</notes>
</task_summary>
\`\`\`

- \`change\` must be one of \`added\` / \`modified\` / \`deleted\`.
- Only list \`<verification>\` commands you ran, or ones the user can trivially run to confirm your work (tests, typecheck, lint, build). Never fabricate output — only the command string.
- All child tags except \`<what_was_done>\` are optional; omit sections that don't apply.
- **Skip the block entirely** for one-line changes, Q&A responses, or turns that only asked \`<questions_for_user>\`. Don't emit a bare "I did nothing" summary.

**Do not emit.** \`<agent_status>\`, \`<pending_action>\`, \`<session_context>\`, \`<action_log>\`, or \`<cli_approval_needed>\` are IDE-side concepts, not model output — the IDE generates them itself. Never emit them yourself.

**Do not use the built-in \`Skill\` / skill-invocation tool.** This IDE does not register any Claude Code skills, so any \`Skill\` call will fail with "Execute skill: …". Use the direct \`Read\`, \`Write\`, \`Edit\`, and \`Bash\` tools instead — they do exactly what a skill would have wrapped, and their output is what the IDE renders.
`;

// ─── Skill-aware append-system-prompt factory ────────────────────────────────
// The user's session-level skill flags (test_first, security_review,
// explain_changes, minimal_diff, performance_notes, accessibility) need to
// reach the CLI. `renderSessionContext` (which carries them in the base prompt
// path) is refused as prompt injection by Claude Code, so instead we append the
// enabled skills as extra behavioural rules through the sanctioned
// `--append-system-prompt` channel — where the CLI treats them as legitimate.

const SKILL_INSTRUCTIONS: Record<string, string> = {
  test_first: '`test_first`: propose or write tests BEFORE the implementation. If asked to add a feature, sketch the test first, then implement.',
  security_review: '`security_review`: after any code touching input parsing, auth, secrets, network, or filesystem, append a brief `<security_review>` block flagging risks and the mitigation you took.',
  explain_changes: '`explain_changes`: after each file change, append a plain-English `<change_explanation>` block that says what changed and why in 1–3 sentences.',
  minimal_diff: '`minimal_diff`: make the SMALLEST change that achieves the goal. Do not refactor unrelated code, do not reformat, do not touch files that don\'t need touching. If you must add a helper, add it near where it\'s used.',
  performance_notes: '`performance_notes`: when you introduce a loop, allocation, blocking I/O, or non-trivial complexity, note it briefly in prose so the reviewer can catch regressions.',
  accessibility: '`accessibility`: any UI code you produce must include ARIA labels, keyboard navigation, focus management, and colour-contrast considerations.',
};

// In supervised mode the IDE runs the CLI with `--permission-mode acceptEdits`,
// which auto-approves edits but DENIES shell commands. A headless CLI can't
// pause for interactive approval, so it would otherwise spam failing commands.
// This clause tells the model to defer shell work instead of attempting it —
// the true "freeze": it stops cleanly at the first shell need and the user
// approves, after which the turn resumes with bypass permissions.
const SUPERVISED_CLAUSE = `

**Supervised mode — do not run shell commands.** The IDE will DENY every Bash/shell command in this session (builds, tests, dev servers, installs, git, package managers). Do NOT attempt them — they fail and waste the turn. Instead:
- Do read-only investigation with Read / Grep / Glob, and make file edits (those are auto-approved).
- When you would run a shell command, STOP: briefly state which commands you need and why, then end your turn. The user grants permission and you resume with full access — do not retry the command yourself first.`;

// When the session build mode is `planning`, the IDE runs the CLI with
// `--permission-mode plan`, so file tools are physically disabled this turn.
// This clause makes the state explicit (the CLI can't otherwise know) and tells
// the model to produce a plan and stop rather than fight the disabled tools.
const PLANNING_CLAUSE = `

**You ARE in planning mode right now.** Do not edit or create files — file-writing tools are disabled for this turn. Produce a \`<plan>…</plan>\` block outlining the concrete implementation steps, and, if any scope decision is the user's to make, a \`<questions_for_user>\` block. Then STOP. Read-only investigation (Read / Grep / Glob) is fine to inform the plan. The user reviews the plan and approves it; only then do you implement (the next turn runs with full permissions).`;

/** Build the CLI-appended prompt with the session's enabled skill flags and
 *  access-level guidance mixed in. Called per turn so toggling a skill or
 *  access level in the config strip takes effect on the very next request. */
export function buildAppendPrompt(skills: SkillFlag[] = [], accessLevel?: string, buildMode?: string): string {
  const enabled = skills
    .filter((s) => s.enabled)
    .map((s) => SKILL_INSTRUCTIONS[s.id])
    .filter(Boolean);

  let prompt = CLAUDE_CODE_APPEND_PROMPT;
  if (enabled.length > 0) {
    prompt += `\n\n**Session behaviors (enabled by the user — honour throughout the turn).**\n${enabled.map((line) => `- ${line}`).join('\n')}\n`;
  }
  // Planning gates edits regardless of access level, so its clause wins; the
  // supervised "no shell" guidance is redundant in a read-only planning turn.
  if (buildMode === 'planning') {
    prompt += PLANNING_CLAUSE;
  } else if (accessLevel === 'supervised') {
    prompt += SUPERVISED_CLAUSE;
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
            appendSystem: req.appendSystem ?? CLAUDE_CODE_APPEND_PROMPT,
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
