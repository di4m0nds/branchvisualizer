// ─── Agent block parser ─────────────────────────────────────────────────────
// Tolerant parser that splits the agent's streamed text into plain-text segments
// and the structured XML-ish blocks defined in the system-prompt document. Any
// unknown markup falls through as text so partial/streaming output never breaks.

import type { AgentBlock } from '@/types/session';
import type { LogDensity } from '@/types';

// Blocks the UI renders specially. Others render as text.
export const KNOWN_BLOCK_TAGS = [
  'agent_status',
  'plan',
  'questions_for_user',
  'pending_action',
  'action_log',
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

const BLOCK_RE = new RegExp(
  `<(${KNOWN_BLOCK_TAGS.join('|')})(\\s[^>]*)?>([\\s\\S]*?)</\\1>`,
  'g',
);

// In "clean" mode we keep only the signal a reviewer cares about: the agent's
// prose, what files it touched, executed CLI commands, its plans/questions, and
// the change explanation. Raw action logs, code dumps, diffs, and intermediate
// review chatter are hidden. "verbose" shows everything.
const CLEAN_KEEP = new Set([
  'text', 'file_changes', 'plan', 'questions_for_user', 'change_explanation', 'context_warning',
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
    blocks.push({
      type: m[1],
      raw: m[0],
      data: { attrs: m[2]?.trim() ?? '', inner: m[3].trim() },
    });
    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) {
    const chunk = text.slice(lastIndex).trim();
    if (chunk) blocks.push({ type: 'text', raw: chunk });
  }

  return blocks;
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

/** Parse a `<questions_for_user>` block's inner XML into structured questions. */
export function parseQuestions(inner: string): AgentQuestion[] {
  const questions: AgentQuestion[] = [];
  const qRe = /<question(\s[^>]*)?>([\s\S]*?)<\/question>/g;
  let qm: RegExpExecArray | null;
  let qi = 0;
  while ((qm = qRe.exec(inner)) !== null) {
    const attrs = qm[1] ?? '';
    const body = qm[2];
    const id = extractAttr(attrs, 'id') ?? `q${qi + 1}`;
    const multi = (extractAttr(attrs, 'multi') ?? 'false').toLowerCase() === 'true';
    const text = extractTag(body, 'text') ?? '';
    const choices: QuestionChoice[] = [];
    const cRe = /<choice(\s[^>]*)?>([\s\S]*?)<\/choice>/g;
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
