import { useCallback, useEffect, useRef, useState } from 'react';
import { DesktopOnlyError } from '@/lib/platform';
import { log } from '@/lib/log';

export interface AsyncResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Refetch with the current deps (e.g. a Retry button). */
  reload: () => void;
}

export interface UseAsyncResourceOptions {
  /** Skip fetching entirely while false (data/error reset to null). */
  enabled?: boolean;
  /** Log scope for failures; defaults to 'async'. */
  scope?: string;
}

/**
 * The one fetch-lifecycle hook: `[data, loading, error]` + stale-response
 * guard + reload. Replaces the copy-pasted then/catch/finally cycle that every
 * workspace tab used to hand-roll.
 *
 * - Stale guard: only the latest in-flight request may commit state, so a
 *   fast tab switch can't paint an older repo's data over the current one.
 * - Errors become user-facing strings; `DesktopOnlyError` keeps its friendly
 *   message. Every failure is also logged for debugging.
 */
export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  opts: UseAsyncResourceOptions = {},
): AsyncResource<T> {
  const { enabled = true, scope = 'async' } = opts;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  // Epoch counter: bumping it invalidates every in-flight request.
  const epochRef = useRef(0);
  const [reloadTick, setReloadTick] = useState(0);

  // The fetcher identity changes every render; deps are the real inputs.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      epochRef.current += 1;
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const epoch = ++epochRef.current;
    setLoading(true);
    setError(null);
    fetcherRef.current()
      .then((result) => {
        if (epochRef.current !== epoch) return; // stale response
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (epochRef.current !== epoch) return;
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(scope, `fetch failed: ${msg}`, err);
        setError(err instanceof DesktopOnlyError ? err.message : msg);
        setData(null);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's inputs
  }, [enabled, reloadTick, ...deps]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  return { data, loading, error, reload };
}
