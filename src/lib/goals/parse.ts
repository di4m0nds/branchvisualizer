// ─── Goal-plan / task-result parsing ─────────────────────────────────────────
// Tolerant extraction of the executor's two structured outputs:
//   <goal_plan>[{"id":"t1","title":…,"deps":["t0"],…}, …]</goal_plan>
//   <task_result status="done|failed|blocked" summary="…"/>  (or body form)
// Models wrap JSON in fences, add prose, or forget tags — every path here
// degrades instead of throwing.

import { GOAL_SUMMARY_CAP, type GoalTask } from '@/types/goals';

interface RawTask {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  deps?: unknown;
  needsApproval?: unknown;
  needs_approval?: unknown;
  verify?: unknown;
  verify_command?: unknown;
}

/**
 * Recover complete top-level `{...}` objects from a (possibly truncated) JSON
 * array body. String-aware brace counting: an output cut off mid-object drops
 * only the unfinished trailing object instead of the whole plan.
 */
function salvageObjects(body: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(body.slice(start, i + 1)));
        } catch { /* skip malformed object */ }
        start = -1;
      }
    }
  }
  return out;
}

/** Best-effort parse of a string into a JSON array. Tries a straight parse,
 *  then the outermost `[...]` slice, then object salvage for truncated output.
 *  Null when nothing array-shaped is recoverable. */
function tryParseArray(s: string): unknown[] | null {
  const trimmed = s.replace(/```(?:json)?/gi, '').trim();
  try {
    const p = JSON.parse(trimmed);
    if (Array.isArray(p)) return p;
  } catch { /* fall through */ }
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const p = JSON.parse(trimmed.slice(start, end + 1));
      if (Array.isArray(p)) return p;
    } catch { /* fall through to salvage */ }
  }
  const salvaged = salvageObjects(start >= 0 ? trimmed.slice(start) : trimmed);
  return salvaged.length > 0 ? salvaged : null;
}

/** Heuristic gate for untagged fallbacks: a real task array is a non-empty list
 *  of objects where at least half carry a string `title`. Keeps a random JSON
 *  array elsewhere in the prose from being misread as a plan. */
export function looksLikeTaskArray(parsed: unknown): parsed is RawTask[] {
  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  const objs = parsed.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
  if (objs.length !== parsed.length) return false;
  const withTitle = objs.filter(
    (o) => typeof (o as RawTask).title === 'string' && (o as RawTask).title!.toString().trim().length > 0,
  ).length;
  return withTitle * 2 >= parsed.length;
}

// Titles the planning/retry prompts use as examples. A model that echoes the
// template verbatim would otherwise produce a "valid" but useless plan.
const PLACEHOLDER_TITLES = new Set([
  'short imperative',
  'imperative task title',
  "what to do and how to know it's done",
]);

/** True for titles that are just the prompt's placeholder text (literal or an
 *  `<angle-bracket>` slot), so an echoed template is rejected. */
export function isPlaceholderTitle(title: string): boolean {
  const t = title.trim().toLowerCase();
  return PLACEHOLDER_TITLES.has(t) || /^<[^>]*>$/.test(t);
}

/** Locate the plan's task array across the tolerated shapes. */
function extractPlanArray(text: string): unknown[] | null {
  // 1. Explicit <goal_plan> tag — closed, else open-tag-to-EOF for truncated
  //    output. The tag is explicit intent, so we don't gate on the heuristic.
  const m = text.match(/<goal_plan(?:\s[^>]*)?>([\s\S]*?)<\/goal_plan>/i)
    ?? text.match(/<goal_plan(?:\s[^>]*)?>([\s\S]*)$/i);
  if (m) {
    const tagged = tryParseArray(m[1]);
    if (tagged) return tagged;
  }
  // 2. No usable tag: a fenced ```json array anywhere in the reply.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const fenced = tryParseArray(fence[1]);
    if (looksLikeTaskArray(fenced)) return fenced;
  }
  // 3. Last resort: a bare top-level JSON array in the prose.
  const bare = tryParseArray(text);
  if (looksLikeTaskArray(bare)) return bare;
  return null;
}

/** Extract and validate the plan's task array. Returns [] when unparseable. */
export function parseGoalPlan(text: string): GoalTask[] {
  const parsed = extractPlanArray(text);
  if (!Array.isArray(parsed)) return [];

  const tasks: GoalTask[] = [];
  const ids = new Set<string>();
  (parsed as RawTask[]).forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title || isPlaceholderTitle(title)) return;
    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `t${i + 1}`;
    while (ids.has(id)) id = `${id}_x`;
    ids.add(id);
    const verifyCmd = typeof raw.verify_command === 'string'
      ? raw.verify_command
      : raw.verify && typeof raw.verify === 'object' && typeof (raw.verify as { command?: unknown }).command === 'string'
        ? (raw.verify as { command: string }).command
        : undefined;
    tasks.push({
      id,
      title,
      description: typeof raw.description === 'string' ? raw.description : title,
      deps: Array.isArray(raw.deps) ? raw.deps.filter((d): d is string => typeof d === 'string') : [],
      status: 'pending',
      attempts: 0,
      needsApproval: raw.needsApproval === true || raw.needs_approval === true || undefined,
      ...(verifyCmd ? { verify: { command: verifyCmd } } : {}),
    });
  });
  // Drop dependency references to unknown ids so the scheduler can't deadlock.
  const known = new Set(tasks.map((t) => t.id));
  for (const t of tasks) t.deps = t.deps.filter((d) => known.has(d) && d !== t.id);
  return tasks;
}

export interface TaskResult {
  status: 'done' | 'failed' | 'blocked';
  summary: string;
}

/** Parse the closing <task_result> tag. Null when absent/malformed. */
export function parseTaskResult(text: string): TaskResult | null {
  // Self-closing or open/close; take the LAST occurrence (a retry within a
  // turn may emit more than one).
  const re = /<task_result\s([^>]*?)(?:\/>|>([\s\S]*?)<\/task_result>)/gi;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) last = m;
  if (!last) return null;
  const attrs = last[1] ?? '';
  const statusMatch = attrs.match(/status\s*=\s*"(done|failed|blocked)"/i);
  if (!statusMatch) return null;
  const summaryAttr = attrs.match(/summary\s*=\s*"([^"]*)"/i)?.[1];
  const body = (last[2] ?? '').trim();
  const summary = (summaryAttr || body || '').slice(0, GOAL_SUMMARY_CAP);
  return { status: statusMatch[1].toLowerCase() as TaskResult['status'], summary };
}

/** Fallback summary when the model forgot the tag: head of the response. */
export function fallbackSummary(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}
