// ─── Agent block parser ─────────────────────────────────────────────────────
// Tolerant parser that splits the agent's streamed text into plain-text segments
// and the structured XML-ish blocks defined in the system-prompt document. Any
// unknown markup falls through as text so partial/streaming output never breaks.

import type { AgentBlock, AgentMessage, AgentRole } from '@/types/session';
import type { LogDensity } from '@/types';

// Blocks the UI renders specially. Others render as text.
export const KNOWN_BLOCK_TAGS = [
  'thinking',
  'agent_status',
  'plan',
  'questions_for_user',
  'pending_action',
  'action_log',
  'cli_approval_needed',
  'task_summary',
  'file_changes',
  'code_file',
  'code_diff',
  'session_state_change',
  'editor_sync',
  'branch_visualizer_refresh',
  'nvim_command',
  'security_review',
  'change_explanation',
  'context_warning',
] as const;

// Attribute run that is quote-aware: it consumes any char that is not `>` or
// `"`, OR a full "quoted string". This lets a `>` live INSIDE a quoted attribute
// value (arrow fns `=>`, generics `Array<T>`, JSX, HTML) without the tag's
// closing `>` being matched early — the bug that mangled choice labels.
const ATTRS = '((?:[^>"]|"[^"]*")*)';

const BLOCK_RE = new RegExp(
  `<(${KNOWN_BLOCK_TAGS.join('|')})${ATTRS}>([\\s\\S]*?)</\\1>`,
  'g',
);

// In "clean" mode we keep only the signal a reviewer cares about: the agent's
// prose, what files it touched, executed CLI commands, its plans/questions, and
// the change explanation. Raw action logs, code dumps, diffs, and intermediate
// review chatter are hidden. "verbose" shows everything.
const CLEAN_KEEP = new Set([
  'text', 'file_changes', 'plan', 'questions_for_user', 'change_explanation', 'context_warning',
  'cli_approval_needed', 'pending_action', 'task_summary',
]);

/** Filter parsed blocks for the given transcript density. */
export function filterBlocksByDensity(blocks: AgentBlock[], density: LogDensity): AgentBlock[] {
  if (density === 'verbose') return blocks;
  return blocks.filter((b) => {
    if (CLEAN_KEEP.has(b.type)) return true;
    // Keep executed shell commands (they're high-signal); drop other tool logs.
    if (b.type === 'action_log') return String(b.data?.tool ?? '') === 'run_command';
    return false;
  });
}

/** Hydrate the flat fields the `<ActionLog>` renderer reads directly off
 *  `block.data` — `tool`, `description`, `status`, `output`. The tolerant
 *  parser only stores `attrs` (raw attribute string) and `inner` (raw inner
 *  XML), so a streamed `<action_log tool="grep"><description>…</description>…`
 *  would otherwise render as "undefined undefined". This flattens once at
 *  parse time so renderers stay dumb, and self-heals older transcripts that
 *  had the same XML shape. */
function hydrateActionLog(data: Record<string, unknown>): Record<string, unknown> {
  const attrs = String(data.attrs ?? '');
  const inner = String(data.inner ?? '');
  const tool = extractAttr(attrs, 'tool') || 'tool';
  const description = extractTag(inner, 'description') || tool;
  const status = (extractTag(inner, 'status') || 'complete') as string;
  const output = extractTag(inner, 'output') || '';
  return { ...data, tool, description, status, output };
}

/** Flatten a `<pending_action>` block (a supervised-mode API model proposing an
 *  action in prose) into fields the approval card reads directly. */
function hydratePendingAction(data: Record<string, unknown>): Record<string, unknown> {
  const inner = String(data.inner ?? '');
  return {
    ...data,
    actionType: extractTag(inner, 'type') || 'action',
    description: extractTag(inner, 'description') || '',
    command: extractTag(inner, 'command') || '',
    filesAffected: extractTag(inner, 'files_affected') || '',
    risk: extractTag(inner, 'risk') || 'low',
    reason: extractTag(inner, 'reason') || '',
  };
}

/** Parse the CLI approval card's `<cmd>` list into a string[]. */
function hydrateApprovalCard(data: Record<string, unknown>): Record<string, unknown> {
  const inner = String(data.inner ?? '');
  const reason = extractTag(inner, 'reason') || 'The agent needs your permission to run commands.';
  const cmds: string[] = [];
  const re = /<cmd>([\s\S]*?)<\/cmd>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const t = m[1].trim();
    if (t) cmds.push(t);
  }
  return { ...data, reason, commands: cmds };
}

export interface TaskSummaryFile {
  path: string;
  change: 'added' | 'modified' | 'deleted' | string;
  description: string;
}

/** Hydrate the structured `<task_summary>` block: prose sections + `<file>` and
 *  `<command>` collections. Renderer reads flat fields. */
function hydrateTaskSummary(data: Record<string, unknown>): Record<string, unknown> {
  const inner = String(data.inner ?? '');
  const whatWasDone = extractTag(inner, 'what_was_done') || '';
  const rootCause = extractTag(inner, 'root_cause') || '';
  const features = extractTag(inner, 'features') || '';
  const notes = extractTag(inner, 'notes') || '';

  const filesInner = extractTag(inner, 'files') || '';
  const files: TaskSummaryFile[] = [];
  const fileRe = /<file(\s[^>]*)?>([\s\S]*?)<\/file>/g;
  let fm: RegExpExecArray | null;
  while ((fm = fileRe.exec(filesInner)) !== null) {
    const attrs = fm[1] ?? '';
    files.push({
      path: extractAttr(attrs, 'path') || '(unknown)',
      change: (extractAttr(attrs, 'change') || 'modified') as string,
      description: fm[2].trim(),
    });
  }

  const verifyInner = extractTag(inner, 'verification') || '';
  const commands: string[] = [];
  const cmdRe = /<command>([\s\S]*?)<\/command>/g;
  let cm: RegExpExecArray | null;
  while ((cm = cmdRe.exec(verifyInner)) !== null) {
    const t = cm[1].trim();
    if (t) commands.push(t);
  }

  return { ...data, whatWasDone, rootCause, features, notes, files, commands };
}

/** Parse assistant text into ordered text + structured blocks. */
export function parseAgentBlocks(text: string): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;

  while ((m = BLOCK_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      const chunk = text.slice(lastIndex, m.index).trim();
      if (chunk) blocks.push({ type: 'text', raw: chunk });
    }
    const type = m[1];
    const data: Record<string, unknown> = {
      attrs: m[2]?.trim() ?? '',
      inner: m[3].trim(),
    };
    let hydrated = data;
    if (type === 'action_log') hydrated = hydrateActionLog(data);
    else if (type === 'pending_action') hydrated = hydratePendingAction(data);
    else if (type === 'cli_approval_needed') hydrated = hydrateApprovalCard(data);
    else if (type === 'task_summary') hydrated = hydrateTaskSummary(data);
    blocks.push({
      type,
      raw: m[0],
      data: hydrated,
    });
    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) {
    const chunk = text.slice(lastIndex).trim();
    if (chunk) blocks.push({ type: 'text', raw: chunk });
  }

  return blocks;
}

/** Compose the block list for a streaming assistant message: the tolerant
 *  parse of its prose, with any extended-thinking text prepended as a synthetic
 *  `thinking` block. Shared by the render path (derive live) and the loop's
 *  finalize step so both produce identical output. */
export function composeStreamingBlocks(text: string, thinking?: string): AgentBlock[] {
  const parsed = parseAgentBlocks(text);
  return thinking
    ? [{ type: 'thinking', raw: thinking, data: { inner: thinking } }, ...parsed]
    : parsed;
}

/** Clean prose for the Copy action: keep only the assistant's `text` blocks
 *  (prose + lightweight markdown, incl. fenced code) and drop every structured
 *  XML block — action logs, thinking, task summaries, plans, questions, etc. so
 *  the clipboard has the readable answer, not the raw tag soup. */
export function plainTextForCopy(text: string): string {
  return parseAgentBlocks(text)
    .filter((b) => b.type === 'text')
    .map((b) => b.raw)
    .join('\n\n')
    .trim();
}

/** Extract a single XML-ish tag's inner text (first match), or null. */
export function extractTag(source: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = source.match(re);
  return m ? m[1].trim() : null;
}

/** Extract an attribute value from an opening-tag attribute string. */
export function extractAttr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

// ─── Interactive Q&A block ───────────────────────────────────────────────────
// The agent can block a turn to ask the user structured multiple-choice
// questions. Shape:
//   <questions_for_user>
//     <question id="q1" multi="false">
//       <text>Which auth method?</text>
//       <choice id="c1" description="…">OAuth</choice>
//       <choice id="c2">JWT</choice>
//     </question>
//   </questions_for_user>

export interface QuestionChoice {
  id: string;
  label: string;
  description?: string;
}
export interface AgentQuestion {
  id: string;
  text: string;
  multi: boolean;
  choices: QuestionChoice[];
}

/** Parse a `<questions_for_user>` block's inner XML into structured questions.
 *  Both tag regexes use the quote-aware `ATTRS` run so a `>` inside a
 *  `description="…"` (code, generics, JSX) doesn't split the tag and leak into
 *  the choice label. */
export function parseQuestions(inner: string): AgentQuestion[] {
  const questions: AgentQuestion[] = [];
  const qRe = new RegExp(`<question${ATTRS}>([\\s\\S]*?)<\\/question>`, 'g');
  let qm: RegExpExecArray | null;
  let qi = 0;
  while ((qm = qRe.exec(inner)) !== null) {
    const attrs = qm[1] ?? '';
    const body = qm[2];
    const id = extractAttr(attrs, 'id') ?? `q${qi + 1}`;
    const multi = (extractAttr(attrs, 'multi') ?? 'false').toLowerCase() === 'true';
    const text = extractTag(body, 'text') ?? '';
    const choices: QuestionChoice[] = [];
    const cRe = new RegExp(`<choice${ATTRS}>([\\s\\S]*?)<\\/choice>`, 'g');
    let cm: RegExpExecArray | null;
    let ci = 0;
    while ((cm = cRe.exec(body)) !== null) {
      const cAttrs = cm[1] ?? '';
      choices.push({
        id: extractAttr(cAttrs, 'id') ?? `c${ci + 1}`,
        label: cm[2].trim(),
        description: extractAttr(cAttrs, 'description') ?? undefined,
      });
      ci += 1;
    }
    if (text && choices.length > 0) questions.push({ id, text, multi, choices });
    qi += 1;
  }
  return questions;
}

// ─── Timeline derivation ─────────────────────────────────────────────────────
// Groups the flat message list into turns for the collapsible chat timeline. A
// `user` message opens a turn; every following `assistant` message (the streamed
// prose plus the per-tool `action_log` messages the loop emits) belongs to that
// turn until the next `user` message. Each turn exposes an ordered list of
// steps (thinking → tool calls → answer), each carrying the id of the message it
// lives in so the UI can scroll to it. Pure and memoizable.

export type StepKind =
  | 'thinking' | 'grep' | 'read_file' | 'edit_file' | 'run_command' | 'tool' | 'answer';

export interface TimelineStep {
  kind: StepKind;
  label: string;
  messageId: string;
  status?: 'complete' | 'error';
}

export interface TimelineTurn {
  role: AgentRole;
  ts: string;
  /** Message to scroll to when the turn header is clicked. */
  messageId: string;
  steps: TimelineStep[];
}

const TOOL_KIND: Record<string, StepKind> = {
  grep: 'grep',
  read_file: 'read_file',
  write_file: 'edit_file',
  edit_file: 'edit_file',
  run_command: 'run_command',
};

function stepsForMessage(m: AgentMessage): TimelineStep[] {
  const out: TimelineStep[] = [];
  let hasProse = false;
  for (const b of m.blocks) {
    if (b.type === 'thinking') {
      out.push({ kind: 'thinking', label: 'Thinking', messageId: m.id });
    } else if (b.type === 'action_log') {
      const tool = String(b.data?.tool ?? '');
      out.push({
        kind: TOOL_KIND[tool] ?? 'tool',
        label: String(b.data?.description ?? tool ?? 'tool'),
        messageId: m.id,
        status: String(b.data?.status ?? '') === 'error' ? 'error' : 'complete',
      });
    } else if (b.type === 'text') {
      hasProse = true;
    }
  }
  // Also treat plain streamed text (no blocks yet) as prose.
  if (hasProse || (m.blocks.length === 0 && m.text.trim())) {
    out.push({ kind: 'answer', label: 'Answer', messageId: m.id });
  }
  return out;
}

/** Group messages into timeline turns. Boundaries anchor on `user` only. */
export function deriveSteps(messages: AgentMessage[]): TimelineTurn[] {
  const turns: TimelineTurn[] = [];
  let current: TimelineTurn | null = null;

  for (const m of messages) {
    if (m.role === 'user') {
      current = { role: 'user', ts: m.ts, messageId: m.id, steps: [] };
      turns.push(current);
      continue;
    }
    // assistant message — start an agent turn if the last turn was the user's.
    if (!current || current.role === 'user') {
      current = { role: 'assistant', ts: m.ts, messageId: m.id, steps: [] };
      turns.push(current);
    }
    current.steps.push(...stepsForMessage(m));
  }
  return turns;
}
