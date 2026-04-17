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

// ─── Rate limit callback ───────────────────────────────────────────────────
// Called after every API response so the UI can update the remaining count
// in real-time without waiting for a full repo reload.
let _onRateLimitUpdate: ((rl: RateLimit) => void) | null = null;
export function setRateLimitCallback(fn: ((rl: RateLimit) => void) | null): void {
  _onRateLimitUpdate = fn;
}

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
  // Notify listener on every request so the UI stays live
  if (rateLimit && _onRateLimitUpdate) _onRateLimitUpdate(rateLimit);

  if (!res.ok) {
    if (res.status === 403) {
      if (rateLimit && rateLimit.remaining === 0) {
        throw new GitHubError(
          `GitHub API rate limit exceeded. Resets at ${rateLimit.resetAt.toLocaleTimeString()}. Add a token to increase limits.`,
          403,
          true,
        );
      }
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
  homepage: string | null;
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

// ─── CI types ──────────────────────────────────────────────────────────────

export interface WorkflowRun {
  id: number;
  name: string | null;
  headBranch: string | null;
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'neutral' | 'stale' | null;
  workflowName: string;
  event: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  actor: { login: string; avatarUrl: string } | null;
  runNumber: number;
  runAttempt: number;
}

export interface CheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'neutral' | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string;
  app: { name: string; slug: string } | null;
}

export interface CommitCombinedStatus {
  state: 'success' | 'failure' | 'pending' | 'error';
  statuses: Array<{
    context: string;
    state: 'success' | 'failure' | 'pending' | 'error';
    description: string | null;
    targetUrl: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  totalCount: number;
}

export interface WorkflowJobStep {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | null;
  number: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkflowJob {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'neutral' | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string;
  steps: WorkflowJobStep[];
  runnerId: number | null;
  runnerName: string | null;
}

export interface WorkflowArtifact {
  id: number;
  name: string;
  sizeInBytes: number;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  url: string;
}

// ─── GH raw shapes for CI ─────────────────────────────────────────────────

interface GHWorkflowRun {
  id: number;
  name: string | null;
  head_branch: string | null;
  head_sha: string;
  status: WorkflowRun['status'];
  conclusion: WorkflowRun['conclusion'];
  event: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  actor: { login: string; avatar_url: string } | null;
  run_number: number;
  run_attempt: number;
  path: string; // e.g. ".github/workflows/ci.yml"
}

interface GHCheckRun {
  id: number;
  name: string;
  status: CheckRun['status'];
  conclusion: CheckRun['conclusion'];
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
  app: { name: string; slug: string } | null;
}

interface GHWorkflowJobStep {
  name: string;
  status: WorkflowJobStep['status'];
  conclusion: WorkflowJobStep['conclusion'];
  number: number;
  started_at: string | null;
  completed_at: string | null;
}

interface GHWorkflowJob {
  id: number;
  name: string;
  status: WorkflowJob['status'];
  conclusion: WorkflowJob['conclusion'];
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
  steps: GHWorkflowJobStep[];
  runner_id: number | null;
  runner_name: string | null;
}

interface GHWorkflowArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  created_at: string;
  expires_at: string | null;
  expired: boolean;
  archive_download_url: string;
}

interface GHCombinedStatus {
  state: CommitCombinedStatus['state'];
  statuses: Array<{
    context: string;
    state: CommitCombinedStatus['statuses'][0]['state'];
    description: string | null;
    target_url: string | null;
    created_at: string;
    updated_at: string;
  }>;
  total_count: number;
}

// ─── PR / Issue types ──────────────────────────────────────────────────────

export interface PRInfo {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  user: { login: string; avatarUrl: string };
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  url: string;
  labels: string[];
  base: string;
  head: string;
  mergeCommitSha: string | null;
}

export interface IssueInfo {
  number: number;
  title: string;
  state: 'open' | 'closed';
  user: { login: string; avatarUrl: string };
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  url: string;
  labels: string[];
  comments: number;
  isPR: boolean;
}

export interface FileNode {
  path: string;
  name: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  children?: FileNode[];
}

interface GHPull {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  html_url: string;
  labels: Array<{ name: string }>;
  base: { ref: string };
  head: { ref: string };
  merge_commit_sha: string | null;
}

interface GHIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  labels: Array<{ name: string }>;
  comments: number;
  pull_request?: { url: string };
}

interface GHTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
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
    homepage: data.homepage || null,
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

// ─── PRs ──────────────────────────────────────────────────────────────────

export async function fetchPRs(
  owner: string,
  repo: string,
  page = 1,
): Promise<{ prs: PRInfo[]; hasMore: boolean }> {
  const path = `/repos/${owner}/${repo}/pulls?state=all&per_page=50&sort=updated&direction=desc&page=${page}`;
  const { data } = await apiFetch<GHPull[]>(path, { cache: true, cacheTtl: 60_000 });

  const prs: PRInfo[] = data.map((p): PRInfo => ({
    number: p.number,
    title: p.title,
    state: p.merged_at ? 'merged' : p.state as 'open' | 'closed',
    draft: p.draft,
    user: { login: p.user.login, avatarUrl: p.user.avatar_url },
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    closedAt: p.closed_at,
    mergedAt: p.merged_at,
    additions: p.additions ?? null,
    deletions: p.deletions ?? null,
    changedFiles: p.changed_files ?? null,
    url: p.html_url,
    labels: p.labels.map(l => l.name),
    base: p.base.ref,
    head: p.head.ref,
    mergeCommitSha: p.merge_commit_sha,
  }));

  return { prs, hasMore: data.length === 50 };
}

// ─── Issues ───────────────────────────────────────────────────────────────

export async function fetchIssues(
  owner: string,
  repo: string,
  page = 1,
): Promise<{ issues: IssueInfo[]; hasMore: boolean }> {
  const path = `/repos/${owner}/${repo}/issues?state=all&per_page=50&sort=updated&direction=desc&page=${page}`;
  const { data } = await apiFetch<GHIssue[]>(path, { cache: true, cacheTtl: 60_000 });

  const issues: IssueInfo[] = data
    .map((i): IssueInfo => ({
      number: i.number,
      title: i.title,
      state: i.state as 'open' | 'closed',
      user: { login: i.user.login, avatarUrl: i.user.avatar_url },
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      closedAt: i.closed_at,
      url: i.html_url,
      labels: i.labels.map(l => l.name),
      comments: i.comments,
      isPR: !i.pull_request,
    }));

  return { issues, hasMore: data.length === 50 };
}

// ─── File tree ────────────────────────────────────────────────────────────

export async function fetchFileTree(
  owner: string,
  repo: string,
  treeSha: string,
): Promise<FileNode[]> {
  const path = `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
  const { data } = await apiFetch<{ tree: GHTreeItem[]; truncated: boolean }>(path, {
    cache: true,
    cacheTtl: 5 * 60_000,
  });

  return buildFileTree(data.tree);
}

function buildFileTree(items: GHTreeItem[]): FileNode[] {
  const root: FileNode[] = [];
  const nodeMap = new Map<string, FileNode>();

  const sorted = [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const item of sorted) {
    const node: FileNode = {
      path: item.path,
      name: item.path.split('/').pop() ?? item.path,
      type: item.type,
      sha: item.sha,
      size: item.size,
      children: item.type === 'tree' ? [] : undefined,
    };

    nodeMap.set(item.path, node);

    const parts = item.path.split('/');
    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = nodeMap.get(parentPath);
      if (parent?.children) {
        parent.children.push(node);
      } else {
        root.push(node);
      }
    }
  }

  return root;
}

// ─── Single commit details (stats + files) ────────────────────────────────

export interface CommitFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  previousFilename?: string;
}

export interface CommitDetails {
  stats: { additions: number; deletions: number; total: number } | null;
  files: CommitFile[];
}

interface GHCommitFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  previous_filename?: string;
}

interface GHCommitFull extends GHCommit {
  files?: GHCommitFile[];
}

export async function fetchCommitDetails(
  owner: string,
  repo: string,
  sha: string,
): Promise<CommitDetails> {
  const path = `/repos/${owner}/${repo}/commits/${sha}`;
  const { data } = await apiFetch<GHCommitFull>(path, { cache: true, cacheTtl: 30 * 60_000 });

  const files: CommitFile[] = (data.files ?? []).map((f): CommitFile => ({
    filename: f.filename,
    status: f.status as CommitFile['status'],
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    previousFilename: f.previous_filename,
  }));

  return {
    stats: data.stats ?? null,
    files,
  };
}

// ─── Releases & Deployments ───────────────────────────────────────────────

export interface ReleaseInfo {
  id: number;
  tagName: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  createdAt: string;
  publishedAt: string | null;
  url: string;
  author: { login: string; avatarUrl: string };
  assets: number;
  tarballUrl: string | null;
  zipballUrl: string | null;
}

export interface DeploymentInfo {
  id: number;
  ref: string;
  sha: string;
  environment: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  creator: { login: string; avatarUrl: string } | null;
  statuses?: DeploymentStatus[];
}

export interface DeploymentStatus {
  state: 'error' | 'failure' | 'inactive' | 'pending' | 'success' | 'queued' | 'in_progress';
  description: string | null;
  environmentUrl: string | null;
  logUrl: string | null;
  createdAt: string;
}

interface GHRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  html_url: string;
  author: { login: string; avatar_url: string };
  assets: unknown[];
  tarball_url: string | null;
  zipball_url: string | null;
}

interface GHDeployment {
  id: number;
  ref: string;
  sha: string;
  environment: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  url: string;
  repository_url: string;
  creator: { login: string; avatar_url: string } | null;
  statuses_url: string;
}

interface GHDeploymentStatus {
  state: 'error' | 'failure' | 'inactive' | 'pending' | 'success' | 'queued' | 'in_progress';
  description: string | null;
  environment_url: string | null;
  log_url: string | null;
  created_at: string;
}

export async function fetchReleases(
  owner: string,
  repo: string,
): Promise<{ releases: ReleaseInfo[] }> {
  const path = `/repos/${owner}/${repo}/releases?per_page=30`;
  const { data } = await apiFetch<GHRelease[]>(path, { cache: true, cacheTtl: 60_000 });

  const releases: ReleaseInfo[] = data.map((r): ReleaseInfo => ({
    id: r.id,
    tagName: r.tag_name,
    name: r.name,
    body: r.body,
    draft: r.draft,
    prerelease: r.prerelease,
    createdAt: r.created_at,
    publishedAt: r.published_at,
    url: r.html_url,
    author: { login: r.author.login, avatarUrl: r.author.avatar_url },
    assets: r.assets.length,
    tarballUrl: r.tarball_url,
    zipballUrl: r.zipball_url,
  }));

  return { releases };
}

export async function fetchDeployments(
  owner: string,
  repo: string,
): Promise<{ deployments: DeploymentInfo[] }> {
  const path = `/repos/${owner}/${repo}/deployments?per_page=50`;
  const { data } = await apiFetch<GHDeployment[]>(path, { cache: true, cacheTtl: 60_000 });

  // Fetch latest status for each deployment (limit to first 20 to avoid rate limit)
  const deploymentsWithStatuses = await Promise.all(
    data.slice(0, 20).map(async (d): Promise<DeploymentInfo> => {
      let statuses: DeploymentStatus[] | undefined;
      try {
        const statusPath = `/repos/${owner}/${repo}/deployments/${d.id}/statuses?per_page=5`;
        const { data: statusData } = await apiFetch<GHDeploymentStatus[]>(statusPath, {
          cache: true,
          cacheTtl: 30_000,
        });
        statuses = statusData.map((s): DeploymentStatus => ({
          state: s.state,
          description: s.description,
          environmentUrl: s.environment_url,
          logUrl: s.log_url,
          createdAt: s.created_at,
        }));
      } catch {
        // ignore status fetch errors
      }
      return {
        id: d.id,
        ref: d.ref,
        sha: d.sha.slice(0, 7),
        environment: d.environment,
        description: d.description,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        url: d.url,
        creator: d.creator ? { login: d.creator.login, avatarUrl: d.creator.avatar_url } : null,
        statuses,
      };
    }),
  );

  return { deployments: deploymentsWithStatuses };
}

// ─── CI: Workflow Runs ────────────────────────────────────────────────────

export async function fetchWorkflowRuns(
  owner: string,
  repo: string,
  branch?: string,
): Promise<{ runs: WorkflowRun[] }> {
  const branchQ = branch ? `&branch=${encodeURIComponent(branch)}` : '';
  const path = `/repos/${owner}/${repo}/actions/runs?per_page=30${branchQ}`;
  const { data } = await apiFetch<{ workflow_runs: GHWorkflowRun[] }>(path, {
    cache: true,
    cacheTtl: 30_000,
  });

  const runs: WorkflowRun[] = (data.workflow_runs ?? []).map((r): WorkflowRun => {
    // derive workflow name from path e.g. ".github/workflows/ci.yml" → "ci"
    const workflowName = r.name ?? (r.path ? r.path.split('/').pop()?.replace(/\.ya?ml$/, '') ?? r.path : 'Workflow');
    return {
      id: r.id,
      name: r.name,
      headBranch: r.head_branch,
      headSha: r.head_sha,
      status: r.status,
      conclusion: r.conclusion,
      workflowName,
      event: r.event,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      url: r.html_url,
      actor: r.actor ? { login: r.actor.login, avatarUrl: r.actor.avatar_url } : null,
      runNumber: r.run_number,
      runAttempt: r.run_attempt,
    };
  });

  return { runs };
}

// ─── CI: Jobs for a workflow run ─────────────────────────────────────────

export async function fetchWorkflowJobs(
  owner: string,
  repo: string,
  runId: number,
): Promise<{ jobs: WorkflowJob[] }> {
  const path = `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`;
  const { data } = await apiFetch<{ jobs: GHWorkflowJob[] }>(path, {
    cache: true,
    cacheTtl: 30_000,
  });

  const jobs: WorkflowJob[] = (data.jobs ?? []).map((j): WorkflowJob => ({
    id: j.id,
    name: j.name,
    status: j.status,
    conclusion: j.conclusion,
    startedAt: j.started_at,
    completedAt: j.completed_at,
    url: j.html_url,
    steps: (j.steps ?? []).map((s): WorkflowJobStep => ({
      name: s.name,
      status: s.status,
      conclusion: s.conclusion,
      number: s.number,
      startedAt: s.started_at,
      completedAt: s.completed_at,
    })),
    runnerId: j.runner_id,
    runnerName: j.runner_name,
  }));

  return { jobs };
}

// ─── CI: Artifacts for a workflow run ────────────────────────────────────

export async function fetchWorkflowArtifacts(
  owner: string,
  repo: string,
  runId: number,
): Promise<{ artifacts: WorkflowArtifact[] }> {
  const path = `/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=30`;
  const { data } = await apiFetch<{ artifacts: GHWorkflowArtifact[] }>(path, {
    cache: true,
    cacheTtl: 60_000,
  });

  const artifacts: WorkflowArtifact[] = (data.artifacts ?? []).map((a): WorkflowArtifact => ({
    id: a.id,
    name: a.name,
    sizeInBytes: a.size_in_bytes,
    createdAt: a.created_at,
    expiresAt: a.expires_at,
    expired: a.expired,
    url: a.archive_download_url,
  }));

  return { artifacts };
}

// ─── CI: Check Runs for a commit ─────────────────────────────────────────

export async function fetchCommitCheckRuns(
  owner: string,
  repo: string,
  sha: string,
): Promise<{ checkRuns: CheckRun[] }> {
  const path = `/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`;
  const { data } = await apiFetch<{ check_runs: GHCheckRun[] }>(path, {
    cache: true,
    cacheTtl: 30_000,
  });

  const checkRuns: CheckRun[] = (data.check_runs ?? []).map((c): CheckRun => ({
    id: c.id,
    name: c.name,
    status: c.status,
    conclusion: c.conclusion,
    startedAt: c.started_at,
    completedAt: c.completed_at,
    url: c.html_url,
    app: c.app,
  }));

  return { checkRuns };
}

// ─── CI: Combined commit status (legacy statuses API) ────────────────────

export async function fetchCommitStatus(
  owner: string,
  repo: string,
  sha: string,
): Promise<CommitCombinedStatus> {
  const path = `/repos/${owner}/${repo}/commits/${sha}/status`;
  const { data } = await apiFetch<GHCombinedStatus>(path, {
    cache: true,
    cacheTtl: 30_000,
  });

  return {
    state: data.state,
    statuses: (data.statuses ?? []).map(s => ({
      context: s.context,
      state: s.state,
      description: s.description,
      targetUrl: s.target_url,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    })),
    totalCount: data.total_count,
  };
}

// ─── README ───────────────────────────────────────────────────────────────

export async function fetchREADME(
  owner: string,
  repo: string,
): Promise<string> {
  const url = `${API_BASE}/repos/${owner}/${repo}/readme`;
  const headers: HeadersInit = {
    Accept: 'application/vnd.github.html',
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 404) return '';
    throw new GitHubError(`Failed to fetch README (${res.status})`, res.status);
  }
  return res.text();
}
