import { useCallback, useEffect } from 'react';
import { toast } from '@/services/toast';
import { parseGitHubURL } from '../lib/parser';
import { fetchFullRepository, setToken, setRateLimitCallback } from '../lib/github';
import * as localGit from '../lib/localGit';
import { buildGraphData } from '../graph/layout';
import { useAppContext } from '../store/AppContext';
import { addToHistory } from '../lib/history';
import { DesktopOnlyError } from '../lib/platform';
import { setCachedRepo } from '../lib/repoCache';
import { filterCheckpoints } from '../lib/refs';

export function useRepoData() {
  const { state, dispatch } = useAppContext();

  // Register rate-limit callback once — fires after every GitHub API call
  // so the token counter updates in real-time across the entire session.
  // GitHub-only: local git has no rate limit concept.
  useEffect(() => {
    if (state.source !== 'github') return;
    setRateLimitCallback((rateLimit) => {
      dispatch({ type: 'SET_RATE_LIMIT', rateLimit });
    });
    return () => setRateLimitCallback(null);
  }, [dispatch, state.source]);

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

      // Hide t3 checkpoint commits by default; keep the full set for the toggle.
      const displayCommits = filterCheckpoints(commits, state.showCheckpoints);
      const graphData = await new Promise<ReturnType<typeof buildGraphData>>((resolve, reject) => {
        requestAnimationFrame(() => {
          try {
            resolve(buildGraphData(displayCommits, branches, tags));
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
        allCommits: displayCommits,
        rawCommits: commits,
      });

      // Cache by repoRef so IDE sessions can swap this repo in without a refetch.
      setCachedRepo(repoInfo.fullName, {
        repoInfo, graphData, branches, tags, allCommits: displayCommits, rawCommits: commits, source: 'github',
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
  }, [state.token, state.showCheckpoints, dispatch]);

  // ── Local repository loader ──────────────────────────────────────────────
  // Mirrors loadRepo but sources from the local `git` binary via Tauri. Feeds
  // the identical buildGraphData + LOAD_SUCCESS path.
  const loadLocalRepo = useCallback(async (path: string) => {
    const cleaned = path.trim();
    if (!cleaned) {
      const msg = 'Enter a local repository path.';
      dispatch({ type: 'LOAD_ERROR', message: msg });
      return;
    }

    dispatch({ type: 'SET_SOURCE', source: 'local', localPath: cleaned });
    dispatch({ type: 'LOAD_START' });

    const label = cleaned.replace(/\/+$/, '').split('/').pop() || cleaned;
    const loadToastId = toast.loading(`Reading ${label}…`);

    try {
      const { repoInfo, branches, tags, commits } = await localGit.fetchFullRepository(
        cleaned,
        (message, progress) => {
          dispatch({ type: 'SET_LOAD_STATE', state: { message, progress } });
        },
      );

      dispatch({ type: 'SET_LOAD_STATE', state: { message: 'Building graph…', progress: 90 } });

      // Hide t3 checkpoint commits by default; keep the full set for the toggle.
      const displayCommits = filterCheckpoints(commits, state.showCheckpoints);
      const graphData = await new Promise<ReturnType<typeof buildGraphData>>((resolve, reject) => {
        requestAnimationFrame(() => {
          try {
            resolve(buildGraphData(displayCommits, branches, tags));
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
        allCommits: displayCommits,
        rawCommits: commits,
      });

      // Cache by the absolute path (== a local session's repoRef) for swap-in.
      setCachedRepo(cleaned, {
        repoInfo, graphData, branches, tags, allCommits: displayCommits, rawCommits: commits, source: 'local',
      });

      addToHistory(`local:${label}`, cleaned);

      toast.dismiss(loadToastId);
      toast.success(repoInfo.fullName, {
        description: `${commits.length.toLocaleString()} commits · ${branches.length} branches · ${tags.length} tags`,
      });
    } catch (err) {
      const msg =
        err instanceof DesktopOnlyError
          ? 'Local git requires the desktop app. Run `pnpm tauri dev`.'
          : err instanceof Error
            ? err.message
            : String(err);
      dispatch({ type: 'LOAD_ERROR', message: msg });
      toast.dismiss(loadToastId);
      toast.error('Failed to load local repository', { description: msg });
    }
  }, [state.showCheckpoints, dispatch]);

  return { loadRepo, loadLocalRepo };
}
