import { useCallback } from 'react';
import { toast } from '@/services/toast';
import { parseGitHubURL } from '../lib/parser';
import { fetchFullRepository, setToken } from '../lib/github';
import { buildGraphData } from '../graph/layout';
import { useAppContext } from '../store/AppContext';

export function useRepoData() {
  const { state, dispatch } = useAppContext();

  const loadRepo = useCallback(async (url: string) => {
    const parsed = parseGitHubURL(url);
    if (!parsed) {
      const msg = 'Invalid GitHub repository URL. Try: https://github.com/owner/repo';
      dispatch({ type: 'LOAD_ERROR', message: msg });
      toast.error('Invalid URL', { description: msg });
      return;
    }

    setToken(state.token);
    dispatch({ type: 'LOAD_START' });

    const loadToastId = toast.loading(`Loading ${parsed.owner}/${parsed.repo}…`);

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
        // Warn if rate limit is getting low
        if (rateLimit.remaining < 10) {
          toast.warning('GitHub rate limit low', {
            description: `Only ${rateLimit.remaining} API requests remaining. Add a token to increase limits.`,
          });
        }
      }

      dispatch({ type: 'SET_LOAD_STATE', state: { message: 'Building graph…', progress: 90 } });

      const graphData = await new Promise<ReturnType<typeof buildGraphData>>((resolve, reject) => {
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

      toast.dismiss(loadToastId);
      toast.success(`${parsed.owner}/${parsed.repo}`, {
        description: `${commits.length.toLocaleString()} commits · ${branches.length} branches · ${tags.length} tags`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'LOAD_ERROR', message: msg });
      toast.dismiss(loadToastId);
      toast.error('Failed to load repository', { description: msg });
    }
  }, [state.token, dispatch]);

  return { loadRepo };
}
