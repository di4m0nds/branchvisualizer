import { useEffect, useRef, useState } from 'react';
import { fetchCommitCheckRuns, fetchCommitStatus } from '@/lib/github';

export type CINodeStatus = 'success' | 'failure' | 'pending' | 'none';

// Module-level cache: sha → { status, expiry }
const _ciCache = new Map<string, { status: CINodeStatus; expiry: number }>();
const CI_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(sha: string): CINodeStatus | null {
  const entry = _ciCache.get(sha);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    _ciCache.delete(sha);
    return null;
  }
  return entry.status;
}

function setCache(sha: string, status: CINodeStatus): void {
  _ciCache.set(sha, { status, expiry: Date.now() + CI_TTL_MS });
}

// Resolve raw check-run/status data to a simple CINodeStatus
async function fetchCIStatus(
  owner: string,
  repo: string,
  sha: string,
): Promise<CINodeStatus> {
  // Try check runs first (modern API)
  try {
    const { checkRuns } = await fetchCommitCheckRuns(owner, repo, sha);
    if (checkRuns.length > 0) {
      const hasFailure = checkRuns.some(
        c => c.conclusion === 'failure' || c.conclusion === 'timed_out',
      );
      if (hasFailure) return 'failure';
      const hasPending = checkRuns.some(
        c => c.status === 'in_progress' || c.status === 'queued',
      );
      if (hasPending) return 'pending';
      const allSuccess = checkRuns.every(c => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral');
      if (allSuccess) return 'success';
      return 'none';
    }
  } catch {
    // fall through to legacy status
  }

  // Fallback: legacy commit status API
  try {
    const combined = await fetchCommitStatus(owner, repo, sha);
    if (combined.totalCount === 0) return 'none';
    if (combined.state === 'success') return 'success';
    if (combined.state === 'failure' || combined.state === 'error') return 'failure';
    if (combined.state === 'pending') return 'pending';
  } catch {
    // ignore
  }

  return 'none';
}

// Simple semaphore — max N concurrent inflight
function makeSemaphore(max: number) {
  let inflight = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (inflight < max) {
      inflight++;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => queue.push(resolve));
  }

  function release(): void {
    const next = queue.shift();
    if (next) {
      next();
    } else {
      inflight--;
    }
  }

  return { acquire, release };
}

const _semaphore = makeSemaphore(3);

export function useCIOverlay(
  owner: string,
  repo: string,
  visibleNodeSHAs: string[],
): Map<string, CINodeStatus> {
  // Feature flag
  const enabled = import.meta.env.VITE_ENABLE_CI_OVERLAY === 'true';

  const [statusMap, setStatusMap] = useState<Map<string, CINodeStatus>>(new Map());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled || !owner || !repo || visibleNodeSHAs.length === 0) return;

    // Which SHAs need fetching (not cached)
    const toFetch = visibleNodeSHAs.filter(sha => getCached(sha) === null);
    if (toFetch.length === 0) {
      // All cached — build map from cache
      const map = new Map<string, CINodeStatus>();
      for (const sha of visibleNodeSHAs) {
        const s = getCached(sha);
        if (s && s !== 'none') map.set(sha, s);
      }
      setStatusMap(map);
      return;
    }

    let cancelled = false;

    async function fetchAll() {
      await Promise.all(
        toFetch.map(async sha => {
          await _semaphore.acquire();
          try {
            if (cancelled) return;
            const status = await fetchCIStatus(owner, repo, sha);
            setCache(sha, status);
          } catch {
            setCache(sha, 'none');
          } finally {
            _semaphore.release();
          }
        }),
      );

      if (cancelled || !mountedRef.current) return;

      // Rebuild map from cache for all visible SHAs
      const map = new Map<string, CINodeStatus>();
      for (const sha of visibleNodeSHAs) {
        const s = getCached(sha);
        if (s && s !== 'none') map.set(sha, s);
      }
      setStatusMap(map);
    }

    fetchAll();
    return () => { cancelled = true; };
  // Join visibleNodeSHAs as a key to avoid running on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, owner, repo, visibleNodeSHAs.join(',')]);

  if (!enabled) return new Map();
  return statusMap;
}
