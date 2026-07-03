// ─── Tiny fuzzy path matcher ────────────────────────────────────────────────
// Subsequence scorer for the @-mention file picker. Deliberately small — no
// dependency — and tuned for paths: matches at segment boundaries and in the
// basename rank above matches buried mid-word, and shorter paths win ties.

/** Characters that start a new "segment" of a path for bonus purposes. */
const BOUNDARY = new Set(['/', '\\', '.', '_', '-']);

/**
 * Score `query` against `target` as a case-insensitive subsequence.
 * Returns `-Infinity` when the query is not a subsequence of the target.
 * Higher is better.
 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length > t.length) return -Infinity;

  const lastSlash = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const found = t.indexOf(c, ti);
    if (found === -1) return -Infinity;
    // Consecutive-run bonus: contiguous matches read as "the thing I typed".
    if (found === prevMatch + 1) score += 8;
    // Segment-start bonus: first char, or char after a path/word boundary.
    if (found === 0 || BOUNDARY.has(t[found - 1])) score += 6;
    // Basename bonus: matches inside the filename beat matches in directories.
    if (found > lastSlash) score += 3;
    // Distance penalty: skipping far ahead means a looser match.
    score -= Math.min(found - ti, 10) * 0.5;
    prevMatch = found;
    ti = found + 1;
  }
  // Prefer shorter targets when the same query matches both.
  score -= t.length * 0.05;
  // Strong bonus when the basename starts with the query's first run.
  const base = t.slice(lastSlash + 1);
  if (base.startsWith(q)) score += 20;
  return score;
}

/** Rank `candidates` by `fuzzyScore` and return the best `limit` matches. */
export function fuzzyFilter(query: string, candidates: string[], limit = 12): string[] {
  if (!query) return candidates.slice(0, limit);
  const scored: Array<{ path: string; score: number }> = [];
  for (const path of candidates) {
    const score = fuzzyScore(query, path);
    if (score > -Infinity) scored.push({ path, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map((s) => s.path);
}
