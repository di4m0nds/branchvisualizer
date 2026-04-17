import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCommitCheckRuns, fetchCommitStatus } from '@/lib/github';

export type CINodeStatus = 'success' | 'failure' | 'pending' | 'none';

// Stable empty map — returned when feature is disabled or no data loaded.
// Module-level constant avoids creating a new reference on every render.
const EMPTY_MAP = new Map<string, CINodeStatus>();

// Module-level cache: sha → { status, expiry }
const _ciCache = new Map<string, { status: CINodeStatus; expiry: number }>();
const CI_TTL_MS = 5 * 60 * 1000;

function getCached(sha: string): CINodeStatus | null {
  const entry = _ciCache.get(sha);
  if (!entry) return null;
  if (Date.now() > entry.expiry) { _ciCache.delete(sha); return null; }
  return entry.status;
}

function setCache(sha: string, status: CINodeStatus): void {
  _ciCache.set(sha, { status, expiry: Date.now() + CI_TTL_MS });
}

async function fetchCIStatus(owner: string, repo: string, sha: string): Promise<CINodeStatus> {
  try {
    const { checkRuns } = await fetchCommitCheckRuns(owner, repo, sha);
    if (checkRuns.length > 0) {
      if (checkRuns.some(c => c.conclusion === 'failure' || c.conclusion === 'timed_out')) return 'failure';
      if (checkRuns.some(c => c.status === 'in_progress' || c.status === 'queued')) return 'pending';
      if (checkRuns.every(c => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral')) return 'success';
      return 'none';
    }
  } catch { /* fall through */ }
  try {
    const combined = await fetchCommitStatus(owner, repo, sha);
    if (combined.totalCount === 0) return 'none';
    if (combined.state === 'success') return 'success';
    if (combined.state === 'failure' || combined.state === 'error') return 'failure';
    if (combined.state === 'pending') return 'pending';
  } catch { /* ignore */ }
  return 'none';
}

function makeSemaphore(max: number) {
  let inflight = 0;
  const queue: Array<() => void> = [];
  return {
    acquire(): Promise<void> {
      if (inflight < max) { inflight++; return Promise.resolve(); }
      return new Promise<void>(resolve => queue.push(resolve));
    },
    release(): void {
      const next = queue.shift();
      if (next) next(); else inflight--;
    },
  };
}

const _semaphore = makeSemaphore(3);

export function useCIOverlay(
  owner: string,
  repo: string,
  visibleNodeSHAs: string[],
): Map<string, CINodeStatus> {
  const enabled = import.meta.env.VITE_ENABLE_CI_OVERLAY === 'true';

  const [statusMap, setStatusMap] = useState<Map<string, CINodeStatus>>(EMPTY_MAP);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Stable string key — effect only re-runs when visible SHAs actually change,
  // not on every render when the array gets a new reference.
  const visibleKey = useMemo(() => visibleNodeSHAs.join(','), [visibleNodeSHAs]);

  useEffect(() => {
    if (!enabled || !owner || !repo || visibleNodeSHAs.length === 0) return;

    const shas = visibleKey.split(',').filter(Boolean);
    const toFetch = shas.filter(sha => getCached(sha) === null);

    function buildMap(): Map<string, CINodeStatus> {
      const map = new Map<string, CINodeStatus>();
      for (const sha of shas) {
        const s = getCached(sha);
        if (s && s !== 'none') map.set(sha, s);
      }
      return map;
    }

    if (toFetch.length === 0) {
      // All cached — use functional update to preserve reference when unchanged
      setStatusMap(prev => {
        const next = buildMap();
        if (prev.size !== next.size) return next;
        for (const [k, v] of next) {
          if (prev.get(k) !== v) return next;
        }
        return prev; // identical content → return same reference, no re-render
      });
      return;
    }

    let cancelled = false;

    async function fetchAll() {
      await Promise.all(
        toFetch.map(async sha => {
          await _semaphore.acquire();
          try {
            if (cancelled) return;
            setCache(sha, await fetchCIStatus(owner, repo, sha));
          } catch {
            setCache(sha, 'none');
          } finally {
            _semaphore.release();
          }
        }),
      );
      if (cancelled || !mountedRef.current) return;
      setStatusMap(prev => {
        const next = buildMap();
        if (prev.size !== next.size) return next;
        for (const [k, v] of next) {
          if (prev.get(k) !== v) return next;
        }
        return prev;
      });
    }

    fetchAll();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, owner, repo, visibleKey]);

  return enabled ? statusMap : EMPTY_MAP;
}
