// ─── Local git data source ─────────────────────────────────────────────────
// Mirrors the public surface of `github.ts` (`fetchFullRepository`,
// `fetchCommitDetails`) but sources data from the local `git` binary via Tauri
// commands (see `src-tauri/src/git.rs`). The returned shapes are identical to the
// GitHub adapter's, so `useRepoData` can call either interchangeably and feed the
// same unchanged `buildGraphData`.

import type { Branch, Commit, RepoInfo, Tag } from '../types';
import type { CommitDetails } from './github';
import { invoke } from './platform';

// The Rust payload uses camelCase serde matching these TS types exactly.
interface LocalRepoPayload {
  repoInfo: RepoInfo;
  branches: Branch[];
  tags: Tag[];
  commits: Commit[];
}

/**
 * Load a local repository's full graph. Analog of `github.fetchFullRepository`.
 * `rateLimit` is always null (the concept doesn't apply to local git; the UI
 * already conditionals on `rateLimit &&`).
 */
export async function fetchFullRepository(
  repoPath: string,
  progressCb: (message: string, progress: number) => void,
): Promise<{
  repoInfo: RepoInfo;
  branches: Branch[];
  tags: Tag[];
  commits: Commit[];
  rateLimit: null;
}> {
  progressCb('Reading local repository…', 10);
  const payload = await invoke<LocalRepoPayload>('git_full_repository', { repoPath });
  progressCb('Parsing commit graph…', 70);
  return { ...payload, rateLimit: null };
}

/** Per-commit file stats. Analog of `github.fetchCommitDetails`. */
export async function fetchCommitDetails(
  repoPath: string,
  sha: string,
): Promise<CommitDetails> {
  return invoke<CommitDetails>('git_commit_details', { repoPath, sha });
}

export interface LocalGitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  clean: boolean;
}

/** Working-tree status — feeds the agent session context. */
export async function fetchStatus(repoPath: string): Promise<LocalGitStatus> {
  return invoke<LocalGitStatus>('git_status', { repoPath });
}
