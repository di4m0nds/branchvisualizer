// ─── GitHub REST API v3 client ─────────────────────────────────────────────
// All fetches go directly to api.github.com (GitHub supports CORS from browsers).

import type { Branch, Commit, CommitAuthor, RateLimit, RepoInfo, Tag } from '../types';
import { cacheGet, cacheSet } from './cache';

const API_BASE = 'https://api.github.com';
const MAX_COMMITS_PER_BRANCH = 150; // pages × 100
const MAX_BRANCHES = 40;

// ─── Low-level fetch ───────────────────────────────────────────────────────

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
    public rateLimitExceeded = false,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

let _token = '';
export function setToken(t: string): void { _token = t.trim(); }
export function getToken(): string { return _token; }

async function apiFetch<T>(path: string, options: { cache?: boolean; cacheTtl?: number } = {}): Promise<{ data: T; rateLimit: RateLimit | null }> {
  const url = `${API_BASE}${path}`;
  const cacheKey = `api:${path}`;

  if (options.cache) {
    const cached = cacheGet<T>('api', cacheKey);
    if (cached) return { data: cached, rateLimit: null };
  }

  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(url, { headers });

  const rateLimit = parseRateLimit(res);

  if (!res.ok) {
    if (res.status === 403) {
      if (rateLimit && rateLimit.remaining === 0) {
        throw new GitHubError(
          `GitHub API rate limit exceeded. Resets at ${rateLimit.resetAt.toLocaleTimeString()}. Add a token to increase limits.`,
          403,
          true,
        );
      }
      // Other 403s: private repo, org SSO required, insufficient token scope, etc.
      const body = await res.text().catch(() => '');
      const hint = body.includes('organization') || body.includes('SSO')
        ? ' Your token may need SSO authorization for this organization.'
        : ' The repository may be private, or your token lacks the required permissions.';
      throw new GitHubError(`Access denied (403).${hint}`, 403);
    }
    if (res.status === 404) throw new GitHubError(`Repository not found or is private.`, 404);
    if (res.status === 401) throw new GitHubError(`GitHub token is invalid or expired.`, 401);
    const body = await res.text().catch(() => '');
    throw new GitHubError(`GitHub API error ${res.status}: ${body.slice(0, 200)}`, res.status);
  }

  const data = (await res.json()) as T;

  if (options.cache) {
    cacheSet('api', cacheKey, data, options.cacheTtl ?? 5 * 60 * 1000);
  }

  return { data, rateLimit };
}

function parseRateLimit(res: Response): RateLimit | null {
  const remaining = Number(res.headers.get('X-RateLimit-Remaining'));
  const limit = Number(res.headers.get('X-RateLimit-Limit'));
  const reset = Number(res.headers.get('X-RateLimit-Reset'));
  if (!limit) return null;
  return {
    remaining: isNaN(remaining) ? 0 : remaining,
    limit: isNaN(limit) ? 60 : limit,
    resetAt: new Date((isNaN(reset) ? 0 : reset) * 1000),
  };
}

// ─── GitHub API response types ─────────────────────────────────────────────

interface GHRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  private: boolean;
  pushed_at: string | null;
  html_url: string;
}

interface GHCommit {
  sha: string;
  commit: {
    author: { name: string; email: string; date: string };
    committer: { name: string; email: string; date: string };
    message: string;
  };
  author: { login: string; avatar_url: string } | null;
  committer: { login: string; avatar_url: string } | null;
  parents: Array<{ sha: string }>;
  stats?: { additions: number; deletions: number; total: number };
}

interface GHBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

interface GHTag {
  name: string;
  commit: { sha: string };
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function fetchRepo(
  owner: string,
  repo: string,
): Promise<{ info: RepoInfo; rateLimit: RateLimit | null }> {
  const { data, rateLimit } = await apiFetch<GHRepo>(`/repos/${owner}/${repo}`, { cache: true, cacheTtl: 60_000 });

  const info: RepoInfo = {
    owner,
    repo,
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    description: data.description,
    starCount: data.stargazers_count,
    forkCount: data.forks_count,
    isPrivate: data.private,
    url: data.html_url,
    pushedAt: data.pushed_at,
  };

  return { info, rateLimit };
}

export async function fetchBranches(owner: string, repo: string, defaultBranch: string): Promise<Branch[]> {
  const { data } = await apiFetch<GHBranch[]>(`/repos/${owner}/${repo}/branches?per_page=100`, {
    cache: true,
    cacheTtl: 30_000,
  });

  const branches = data.slice(0, MAX_BRANCHES).map((b): Branch => ({
    name: b.name,
    sha: b.commit.sha,
    isDefault: b.name === defaultBranch,
    isRemote: false,
  }));

  // Ensure default branch is first
  branches.sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    return a.name.localeCompare(b.name);
  });

  return branches;
}

export async function fetchTags(owner: string, repo: string): Promise<Tag[]> {
  const { data } = await apiFetch<GHTag[]>(`/repos/${owner}/${repo}/tags?per_page=100`, {
    cache: true,
    cacheTtl: 60_000,
  });
  return data.map((t): Tag => ({
    name: t.name,
    sha: t.commit.sha,
    commitSha: t.commit.sha,
  }));
}

function ghCommitToCommit(c: GHCommit): Commit {
  const msg = c.commit.message;
  const nlIdx = msg.indexOf('\n');
  const subject = nlIdx === -1 ? msg : msg.slice(0, nlIdx);
  const body = nlIdx === -1 ? '' : msg.slice(nlIdx + 1).trim();

  const author: CommitAuthor = {
    name: c.commit.author.name,
    email: c.commit.author.email,
    date: c.commit.author.date,
    login: c.author?.login,
    avatarUrl: c.author?.avatar_url,
  };

  const committer: CommitAuthor = {
    name: c.commit.committer.name,
    email: c.commit.committer.email,
    date: c.commit.committer.date,
    login: c.committer?.login,
    avatarUrl: c.committer?.avatar_url,
  };

  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: msg,
    subject,
    body,
    author,
    committer,
    parents: c.parents.map(p => p.sha),
    isMerge: c.parents.length > 1,
    stats: c.stats,
  };
}

/**
 * Fetches commits for a branch, stopping early if we encounter a sha
 * we've already collected (avoids re-walking shared history).
 */
export async function fetchCommitsForBranch(
  owner: string,
  repo: string,
  branchSha: string,
  knownShas: Set<string>,
  onProgress?: (fetched: number) => void,
): Promise<Commit[]> {
  const commits: Commit[] = [];
  let page = 1;
  const perPage = 100;

  while (commits.length < MAX_COMMITS_PER_BRANCH) {
    const path = `/repos/${owner}/${repo}/commits?sha=${branchSha}&per_page=${perPage}&page=${page}`;
    const { data } = await apiFetch<GHCommit[]>(path, { cache: true, cacheTtl: 30_000 });

    if (data.length === 0) break;

    let hitKnown = false;
    for (const c of data) {
      if (knownShas.has(c.sha)) {
        hitKnown = true;
        break;
      }
      commits.push(ghCommitToCommit(c));
      knownShas.add(c.sha);
    }

    onProgress?.(commits.length);

    if (hitKnown || data.length < perPage) break;
    page++;
  }

  return commits;
}

/**
 * Fetches all data needed to build the graph.
 * Calls progressCb with phase name and 0-100 progress.
 */
export async function fetchFullRepository(
  owner: string,
  repo: string,
  progressCb: (message: string, progress: number) => void,
): Promise<{
  repoInfo: RepoInfo;
  branches: Branch[];
  tags: Tag[];
  commits: Commit[];
  rateLimit: RateLimit | null;
}> {
  progressCb('Fetching repository metadata…', 5);
  const { info: repoInfo, rateLimit } = await fetchRepo(owner, repo);

  progressCb('Fetching branches…', 15);
  const branches = await fetchBranches(owner, repo, repoInfo.defaultBranch);

  progressCb('Fetching tags…', 25);
  const tags = await fetchTags(owner, repo);

  // ─── Fetch commits ────────────────────────────────────────────────────
  const allCommits: Commit[] = [];
  const knownShas = new Set<string>();

  const branchesToFetch = branches.slice(0, MAX_BRANCHES);
  const progressPerBranch = 55 / Math.max(branchesToFetch.length, 1);

  for (let i = 0; i < branchesToFetch.length; i++) {
    const branch = branchesToFetch[i];
    const baseProgress = 30 + i * progressPerBranch;
    progressCb(
      `Fetching commits for ${branch.name} (${i + 1}/${branchesToFetch.length})…`,
      Math.round(baseProgress),
    );

    const newCommits = await fetchCommitsForBranch(
      owner, repo, branch.sha, knownShas,
      (n) => progressCb(
        `Fetching commits for ${branch.name}: ${n} found…`,
        Math.round(baseProgress + (n / MAX_COMMITS_PER_BRANCH) * progressPerBranch),
      ),
    );
    allCommits.push(...newCommits);
  }

  progressCb('Sorting commits…', 88);

  return { repoInfo, branches, tags, commits: allCommits, rateLimit };
}
