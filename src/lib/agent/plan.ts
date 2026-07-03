// ─── Implementation plan extraction + section parsing ───────────────────────
// Plans live inline in the conversation as `plan` blocks on assistant messages.
// The Plan view (right column) surfaces the latest one as an editable, section-
// annotated document. These helpers are pure so they're trivial to test.

import type { Session } from '@/types/session';
import { extractTag } from '@/components/agent/blocks';

export interface PlanSource {
  /** The assistant message the plan came from (anchors comments/draft). */
  messageId: string;
  /** The plan's markdown body. */
  text: string;
  /** True while the session is still producing/awaiting a plan. */
  pending: boolean;
}

/** The latest plan across the session, or null if none has been emitted. */
export function latestPlanText(session: Session): PlanSource | null {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (m.role !== 'assistant') continue;
    const planBlock = m.blocks.find((b) => b.type === 'plan');
    if (!planBlock) continue;
    const inner = planBlock.data?.inner;
    const text = String(
      (typeof inner === 'string' && inner) ||
      extractTag(planBlock.raw, 'plan') ||
      planBlock.raw ||
      '',
    ).trim();
    if (!text) continue;
    const pending =
      session.context.buildMode === 'planning' ||
      session.context.status === 'pending_plan_approval' ||
      session.context.status === 'planning';
    return { messageId: m.id, text, pending };
  }
  return null;
}

export interface PlanSection {
  /** Stable within a plan message: `${messageId}:${index}`. */
  id: string;
  /** Heading text ('' for the preamble before the first heading). */
  heading: string;
  /** ATX level 1–6; 0 for the preamble. */
  level: number;
  /** Markdown body between this heading and the next (heading line excluded). */
  body: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^\s*(```|~~~)/;

/**
 * Split plan markdown into sections at ATX headings. Fenced-code aware: a `#`
 * inside a ``` / ~~~ block never starts a new section. A preamble before the
 * first heading becomes a level-0 section with an empty heading.
 */
export function parsePlanSections(md: string, messageId = 'plan'): PlanSection[] {
  const lines = md.split('\n');
  const sections: PlanSection[] = [];
  let cur: { heading: string; level: number; body: string[] } | null = null;
  let inFence = false;
  let fenceToken = '';

  const flush = () => {
    if (!cur) return;
    sections.push({
      id: `${messageId}:${sections.length}`,
      heading: cur.heading,
      level: cur.level,
      body: cur.body.join('\n').trim(),
    });
  };

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!inFence) { inFence = true; fenceToken = token; }
      else if (token === fenceToken) { inFence = false; fenceToken = ''; }
    }

    const headingMatch = !inFence ? line.match(HEADING_RE) : null;
    if (headingMatch) {
      flush();
      cur = { heading: headingMatch[2].trim(), level: headingMatch[1].length, body: [] };
    } else {
      if (!cur) cur = { heading: '', level: 0, body: [] };
      cur.body.push(line);
    }
  }
  flush();

  // Drop a leading empty preamble (whitespace-only) so the view starts clean.
  return sections.filter((s, i) => !(i === 0 && s.level === 0 && !s.heading && !s.body));
}

/** Does the session currently have a plan to show? */
export function sessionHasPlan(session: Session): boolean {
  return session.messages.some(
    (m) => m.role === 'assistant' && m.blocks.some((b) => b.type === 'plan'),
  );
}
