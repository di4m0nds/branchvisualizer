import { useCallback, useEffect } from 'react';
import { toast } from '@/services/toast';
import { parseGitHubURL } from '../lib/parser';
import { fetchFullRepository, setToken, setRateLimitCallback, setApiBase, setGqlEndpoint } from '../lib/github';
import { buildGraphData } from '../graph/layout';
import { useAppContext } from '../store/AppContext';
import { addToHistory } from '../lib/history';

const USE_BACKEND = import.meta.env.VITE_USE_BACKEND === 'true';
const API_URL =
  ((import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')) ??
  'http://localhost:3001';

export function useRepoData() {
  const { state, dispatch } = useAppContext();

  // Register rate-limit callback once — fires after every GitHub API call
  // so the token counter updates in real-time across the entire session.
  useEffect(() => {
    setRateLimitCallback((rateLimit) => {
      dispatch({ type: 'SET_RATE_LIMIT', rateLimit });
    });
    return () => setRateLimitCallback(null);
  }, [dispatch]);

  const loadRepo = useCallback(async (url: string) => {
    const parsed = parseGitHubURL(url);
    if (!parsed) {
      const msg = 'Invalid GitHub repository URL. Try: https://github.com/owner/repo';
      dispatch({ type: 'LOAD_ERROR', message: msg });
      toast.error('Invalid URL', { description: msg });
      return;
    }

    setToken(state.token);

    // Route through proxy only when token is available — forwarded token gives
    // the user their own 5000 req/h quota.
    // Without a token, call GitHub directly from the browser so each visitor
    // gets their own 60 req/h on their own IP instead of sharing the server's quota.
    if (USE_BACKEND && state.token) {
      setApiBase(`${API_URL}/api/github/rest`);
      setGqlEndpoint(`${API_URL}/api/github/graphql`);
    } else {
      setApiBase('https://api.github.com');
      setGqlEndpoint('https://api.github.com/graphql');
    }

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

      // Record in visit history
      addToHistory(
        `${parsed.owner}/${parsed.repo}`,
        `https://github.com/${parsed.owner}/${parsed.repo}`,
      );

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
