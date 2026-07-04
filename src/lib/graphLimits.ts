// ─── Graph fetch limits ──────────────────────────────────────────────────────
// User-tunable caps for how much history the visualizer loads. Read at FETCH
// time by github.ts / localGit callers; edited in Settings → General. 0 means
// "no cap" (large repos: slower fetch + layout, memory grows — the render path
// itself is viewport-culled).

import { swallow } from './log';

const KEY = 'code-agent:graph_limits';

export interface GraphLimits {
  /** GitHub: commits fetched per branch (pages of 100). */
  githubCommitsPerBranch: number;
  /** GitHub: how many branches to walk. */
  githubBranches: number;
  /** Local git: `git log --all --max-count`. 0 = unlimited. */
  localMaxCommits: number;
}

export const DEFAULT_GRAPH_LIMITS: GraphLimits = {
  githubCommitsPerBranch: 150,
  githubBranches: 40,
  localMaxCommits: 2000,
};

export function loadGraphLimits(): GraphLimits {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_GRAPH_LIMITS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_GRAPH_LIMITS };
    const v = JSON.parse(raw) as Partial<GraphLimits>;
    const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : d);
    return {
      githubCommitsPerBranch: num(v.githubCommitsPerBranch, DEFAULT_GRAPH_LIMITS.githubCommitsPerBranch),
      githubBranches: num(v.githubBranches, DEFAULT_GRAPH_LIMITS.githubBranches),
      localMaxCommits: num(v.localMaxCommits, DEFAULT_GRAPH_LIMITS.localMaxCommits),
    };
  } catch (e) {
    swallow('graphLimits', 'load')(e);
    return { ...DEFAULT_GRAPH_LIMITS };
  }
}

export function saveGraphLimits(limits: GraphLimits): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(limits));
  } catch (e) {
    swallow('graphLimits', 'persist')(e);
  }
}

/** Effective cap helpers: 0 = unlimited → a very large sentinel for loops. */
export function capOrInfinity(n: number): number {
  return n === 0 ? Number.MAX_SAFE_INTEGER : n;
}
