import { useCallback } from 'react';
import { buildGraphData } from '@/graph/layout';
import { filterCheckpoints } from '@/lib/refs';
import { log } from '@/lib/log';
import { getAppState, useAppDispatch, useAppSelector } from '@/store/store';

/**
 * Checkpoint-visibility toggle. The reducer only stores the flag; the graph
 * rebuild (potentially thousands of commits) runs here behind
 * requestAnimationFrame — same pattern as useRepoData — and lands via
 * SET_GRAPH_DATA, keeping dispatch cheap.
 */
export function useShowCheckpoints(): { showCheckpoints: boolean; setShowCheckpoints: (show: boolean) => void } {
  const dispatch = useAppDispatch();
  const showCheckpoints = useAppSelector((s) => s.showCheckpoints);

  const setShowCheckpoints = useCallback((show: boolean) => {
    dispatch({ type: 'SET_SHOW_CHECKPOINTS', show });

    const { graphData, rawCommits, branches, tags } = getAppState();
    if (!graphData) return; // nothing loaded — flag persisted, applied on next load

    requestAnimationFrame(() => {
      try {
        const displayCommits = filterCheckpoints(rawCommits, show);
        dispatch({
          type: 'SET_GRAPH_DATA',
          graphData: buildGraphData(displayCommits, branches, tags),
          allCommits: displayCommits,
        });
      } catch (e) {
        log.error('graph', e, 'checkpoint toggle rebuild failed');
      }
    });
  }, [dispatch]);

  return { showCheckpoints, setShowCheckpoints };
}
