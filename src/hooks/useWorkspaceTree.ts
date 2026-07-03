// ─── Workspace tree cache ───────────────────────────────────────────────────
// Cached `walk_tree` results for the @-mention file picker. One walk per
// project root, shared module-wide so switching sessions on the same repo (or
// reopening the menu) never re-walks needlessly. Serve whatever is cached
// immediately; refresh in the background once the cache is stale.

import { useEffect, useState } from 'react';
import { invoke } from '@/lib/platform';

export interface TreeEntry {
  path: string;
  name: string;
  isDir: boolean;
  sizeBytes: number;
  depth: number;
}

const STALE_MS = 60_000;

interface CacheSlot {
  entries: TreeEntry[];
  fetchedAt: number;
  inflight: Promise<TreeEntry[]> | null;
}

const cache = new Map<string, CacheSlot>();

function fetchTree(root: string): Promise<TreeEntry[]> {
  const slot = cache.get(root);
  if (slot?.inflight) return slot.inflight;
  const inflight = invoke<TreeEntry[]>('walk_tree', { root, maxDepth: 0 })
    .then((entries) => {
      cache.set(root, { entries, fetchedAt: Date.now(), inflight: null });
      return entries;
    })
    .catch((e) => {
      if (slot) slot.inflight = null;
      throw e;
    });
  cache.set(root, { entries: slot?.entries ?? [], fetchedAt: slot?.fetchedAt ?? 0, inflight });
  return inflight;
}

/** Synchronous read of whatever the cache holds for `root` (may be empty). */
export function cachedTree(root: string | null): TreeEntry[] {
  if (!root) return [];
  return cache.get(root)?.entries ?? [];
}

/**
 * Workspace file tree for `root`, fetched lazily. Pass `active: false` while
 * the consumer (the @ menu) is closed — nothing is fetched until it opens, and
 * an already-warm cache is served instantly while a stale one refreshes in the
 * background.
 */
export function useWorkspaceTree(root: string | null, active: boolean): {
  entries: TreeEntry[];
  loading: boolean;
  error: string | null;
} {
  const [entries, setEntries] = useState<TreeEntry[]>(() => cachedTree(root));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(cachedTree(root));
    setError(null);
  }, [root]);

  useEffect(() => {
    if (!active || !root) return;
    const slot = cache.get(root);
    const fresh = slot && Date.now() - slot.fetchedAt < STALE_MS;
    if (fresh) {
      setEntries(slot.entries);
      return;
    }
    let alive = true;
    if (!slot?.entries.length) setLoading(true);
    fetchTree(root)
      .then((rows) => {
        if (!alive) return;
        setEntries(rows);
        setError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [active, root]);

  return { entries, loading, error };
}
