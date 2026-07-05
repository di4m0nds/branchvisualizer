import { useCallback } from 'react';
import { toast } from '@/services/toast';
import { parseGitHubURL } from '../lib/parser';
import { fetchFullRepository } from '../lib/github';
import * as localGit from '../lib/localGit';
import { buildGraphData } from '../graph/layout';
import { useAppDispatch, useAppSelector } from '../store/store';
import { addToHistory } from '../lib/history';
import { DesktopOnlyError } from '../lib/platform';
import { setCachedRepo } from '../lib/repoCache';
import { filterCheckpoints } from '../lib/refs';
import type { RepoSource } from '../types';

type ProgressFn = (message: string, progress: number) => void;

interface RepoFetchResult {
  repoInfo: Awaited<ReturnType<typeof fetchFullRepository>>['repoInfo'];
  branches: Awaited<ReturnType<typeof fetchFullRepository>>['branches'];
  tags: Awaited<ReturnType<typeof fetchFullRepository>>['tags'];
  commits: Awaited<ReturnType<typeof fetchFullRepository>>['commits'];
}

/** Everything that differs between the GitHub and local loaders. */
interface RepoLoadSource {
  source: RepoSource;
  /** Toast label while loading ("owner/repo" or the directory basename). */
  label: string;
  /** repoCache key (== a session's repoRef): owner/repo or absolute path. */
  cacheKey: string;
  /** Visit-history entry [name, url/path]. */
  historyEntry: [string, string];
  fetch(onProgress: ProgressFn): Promise<RepoFetchResult>;
  errorTitle: string;
  mapError?(err: unknown): string | null;
}

export function useRepoData() {
  const dispatch = useAppDispatch();
  // Narrow subscriptions: consumers of this hook (ChatPanel, IdeWorkspace, …)
  // must not re-render on unrelated store changes like streamed tokens.
  const showCheckpoints = useAppSelector((s) => s.showCheckpoints);

  // The one shared load pipeline: LOAD_START → fetch → rAF buildGraphData →
  // LOAD_SUCCESS → cache + history + toast. GitHub and local repos only
  // differ in the `RepoLoadSource` they pass in.
  const loadWith = useCallback(async (src: RepoLoadSource) => {
    dispatch({ type: 'LOAD_START' });
    const loadToastId = toast.loading(`Loading ${src.label}…`);

    try {
      const { repoInfo, branches, tags, commits } = await src.fetch((message, progress) => {
        dispatch({ type: 'SET_LOAD_STATE', state: { message, progress } });
      });

      dispatch({ type: 'SET_LOAD_STATE', state: { message: 'Building graph…', progress: 90 } });

      // Hide t3 checkpoint commits by default; keep the full set for the toggle.
      const displayCommits = filterCheckpoints(commits, showCheckpoints);
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
      setCachedRepo(src.cacheKey, {
        repoInfo, graphData, branches, tags, allCommits: displayCommits, rawCommits: commits, source: src.source,
      });

      addToHistory(...src.historyEntry);

      toast.dismiss(loadToastId);
      toast.success(src.source === 'github' ? src.label : repoInfo.fullName, {
        description: `${commits.length.toLocaleString()} commits · ${branches.length} branches · ${tags.length} tags`,
      });
    } catch (err) {
      const msg =
        src.mapError?.(err) ??
        (err instanceof Error ? err.message : String(err));
      dispatch({ type: 'LOAD_ERROR', message: msg });
      toast.dismiss(loadToastId);
      toast.error(src.errorTitle, { description: msg });
    }
  }, [showCheckpoints, dispatch]);

  const loadRepo = useCallback(async (url: string) => {
    const parsed = parseGitHubURL(url);
    if (!parsed) {
      const msg = 'Invalid GitHub repository URL. Try: https://github.com/owner/repo';
      dispatch({ type: 'LOAD_ERROR', message: msg });
      toast.error('Invalid URL', { description: msg });
      return;
    }

    const ref = `${parsed.owner}/${parsed.repo}`;
    await loadWith({
      source: 'github',
      label: ref,
      cacheKey: ref,
      historyEntry: [ref, `https://github.com/${ref}`],
      errorTitle: 'Failed to load repository',
      fetch: async (onProgress) => {
        const { repoInfo, branches, tags, commits, rateLimit } = await fetchFullRepository(
          parsed.owner,
          parsed.repo,
          onProgress,
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
        return { repoInfo, branches, tags, commits };
      },
    });
  }, [dispatch, loadWith]);

  // ── Local repository loader ──────────────────────────────────────────────
  // Same pipeline, sourced from the local `git` binary via Tauri.
  const loadLocalRepo = useCallback(async (path: string) => {
    const cleaned = path.trim();
    if (!cleaned) {
      dispatch({ type: 'LOAD_ERROR', message: 'Enter a local repository path.' });
      return;
    }

    dispatch({ type: 'SET_SOURCE', source: 'local', localPath: cleaned });

    const label = cleaned.replace(/\/+$/, '').split('/').pop() || cleaned;
    await loadWith({
      source: 'local',
      label,
      cacheKey: cleaned,
      historyEntry: [`local:${label}`, cleaned],
      errorTitle: 'Failed to load local repository',
      mapError: (err) =>
        err instanceof DesktopOnlyError
          ? 'Local git requires the desktop app. Run `pnpm tauri dev`.'
          : null,
      fetch: (onProgress) => localGit.fetchFullRepository(cleaned, onProgress),
    });
  }, [dispatch, loadWith]);

  return { loadRepo, loadLocalRepo };
}
