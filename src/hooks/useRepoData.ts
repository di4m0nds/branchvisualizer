import { useCallback } from 'react';
import { parseGitHubURL } from '../lib/parser';
import { fetchFullRepository, setToken } from '../lib/github';
import { buildGraphData } from '../graph/layout';
import { useAppContext } from '../store/AppContext';

export function useRepoData() {
  const { state, dispatch } = useAppContext();

  const loadRepo = useCallback(async (url: string) => {
    const parsed = parseGitHubURL(url);
    if (!parsed) {
      dispatch({ type: 'LOAD_ERROR', message: 'Invalid GitHub repository URL. Try: https://github.com/owner/repo' });
      return;
    }

    setToken(state.token);
    dispatch({ type: 'LOAD_START' });

    try {
      const { repoInfo, branches, tags, commits, rateLimit } = await fetchFullRepository(
        parsed.owner,
        parsed.repo,
        (message, progress) => {
          dispatch({ type: 'SET_LOAD_STATE', state: { message, progress } });
        },
      );

      if (rateLimit) {
        dispatch({ type: 'SET_RATE_LIMIT', rateLimit });
      }

      dispatch({ type: 'SET_LOAD_STATE', state: { message: 'Building graph…', progress: 90 } });

      // Graph layout is synchronous but fast (< 50ms for most repos)
      // For very large repos this could be deferred to a microtask
      const graphData = await new Promise<ReturnType<typeof buildGraphData>>((resolve, reject) => {
        // Yield to browser for one frame so the progress message renders
        requestAnimationFrame(() => {
          try {
            resolve(buildGraphData(commits, branches, tags));
          } catch (e) {
            reject(e);
          }
        });
      });

      dispatch({
        type: 'LOAD_SUCCESS',
        repoInfo,
        graphData,
        branches,
        tags,
        allCommits: commits,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'LOAD_ERROR', message: msg });
    }
  }, [state.token, dispatch]);

  return { loadRepo };
}
