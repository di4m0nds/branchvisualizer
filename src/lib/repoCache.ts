// ─── In-memory repo-data cache ───────────────────────────────────────────────
// The visualizer keeps a single app-global repo (graphData/branches/…), but the
// IDE runs multiple sessions, each potentially bound to a different repo. This
// module caches a loaded repo's data keyed by `repoRef` so switching sessions
// can swap the graph in instantly (via a synthetic LOAD_SUCCESS) instead of
// re-fetching. GraphData holds Maps (non-serializable), so this is memory-only
// and intentionally lost on reload — re-derived on the next load/activate.

import type { Branch, Commit, GraphData, RepoInfo, RepoSource, Tag } from '@/types';

export interface CachedRepo {
  repoInfo: RepoInfo;
  graphData: GraphData;
  branches: Branch[];
  tags: Tag[];
  /** Currently-displayed commits (checkpoint filter applied). */
  allCommits: Commit[];
  /** Full, unfiltered commit set — lets the checkpoint toggle rebuild. */
  rawCommits: Commit[];
  source: RepoSource;
}

const cache = new Map<string, CachedRepo>();

export function getCachedRepo(ref: string): CachedRepo | undefined {
  return cache.get(ref);
}

export function setCachedRepo(ref: string, data: CachedRepo): void {
  if (!ref) return;
  cache.set(ref, data);
}

export function hasCachedRepo(ref: string): boolean {
  return cache.has(ref);
}
