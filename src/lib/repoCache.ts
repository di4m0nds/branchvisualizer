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

// Bounded LRU: each entry holds a full GraphData (with Maps), so an unbounded
// cache slowly grows for the app's lifetime as sessions switch repos. Cap the
// number of retained repos and evict the least-recently-used.
const MAX_ENTRIES = 12;
const cache = new Map<string, CachedRepo>();

export function getCachedRepo(ref: string): CachedRepo | undefined {
  const hit = cache.get(ref);
  // Re-insert to mark as most-recently-used (Map preserves insertion order).
  if (hit) {
    cache.delete(ref);
    cache.set(ref, hit);
  }
  return hit;
}

export function setCachedRepo(ref: string, data: CachedRepo): void {
  if (!ref) return;
  if (cache.has(ref)) cache.delete(ref);
  cache.set(ref, data);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function hasCachedRepo(ref: string): boolean {
  return cache.has(ref);
}
