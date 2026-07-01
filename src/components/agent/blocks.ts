// ─── Agent block parser ─────────────────────────────────────────────────────
// Tolerant parser that splits the agent's streamed text into plain-text segments
// and the structured XML-ish blocks defined in the system-prompt document. Any
// unknown markup falls through as text so partial/streaming output never breaks.

import type { AgentBlock } from '@/types/session';

// Blocks the UI renders specially. Others render as text.
export const KNOWN_BLOCK_TAGS = [
  'agent_status',
  'plan',
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
