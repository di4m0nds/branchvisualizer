// apps/branchvisualizer/src/hooks/useGitHubContext.ts
// Fetches rich GitHub context for the AI assistant.
// Backed by /api/github/rest proxy — no token needed client-side.
//
// IMPORTANT — callback stability:
//   All exported callbacks (loadSelectedCommits, loadRepoTree, attachFile,
//   buildContext) have EMPTY dependency arrays. They read live state via refs
//   that are kept in sync during render. This prevents the infinite-loop pattern
//   where a state change causes a new callback reference which triggers a
//   useEffect which causes another state change.

import { useState, useCallback, useRef } from 'react';
import type { RepoInfo, Commit, GraphNode } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommitPR {
  number: number;
  title: string;
  body: string;
  state: string;
  htmlUrl: string;
  labels: string[];
  author: string;
  mergedAt: string | null;
  baseBranch: string;
  headBranch: string;
}

export interface CommitDetail {
  sha: string;
  subject: string;
  body: string;
  author: string;
  authorEmail?: string;
  date: string;
  htmlUrl?: string;
  parents?: string[];
  stats: { additions: number; deletions: number; total: number };
  /** Full unified diff — may be up to 150K chars when fetched via commit-context API */
  diff: string;
  diffTruncated?: boolean;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    /** Per-file patch (may be absent for very large individual files) */
    patch?: string | null;
  }>;
  /** PRs that include this commit — populated by the commit-context API */
  prs?: CommitPR[];
}

export interface RepoTree {
  sha: string;
  files: string[];
}

export interface AttachedFile {
  path: string;
  content: string;
  ref: string;
}

// ─── GitHub REST fetchers ─────────────────────────────────────────────────────

async function ghFetch(path: string, accept = 'application/vnd.github.v3+json'): Promise<Response> {
  return fetch(`/api/github/rest/${path}`, { headers: { Accept: accept } });
}

/**
 * Fetch rich commit context via the dedicated `/api/assistant/commit-context` endpoint.
 * This endpoint aggregates the commit JSON, full unified diff (up to 150K chars),
 * and any associated PRs in a single server-side round-trip to GitHub.
 *
 * Falls back to the plain GitHub REST proxy if the endpoint is unavailable.
 */
async function fetchCommitDetail(owner: string, repo: string, sha: string): Promise<CommitDetail> {
  // Try the rich commit-context endpoint first
  const ctxRes = await fetch(`/api/assistant/commit-context/${owner}/${repo}/${sha}`);
  if (ctxRes.ok) {
    const d = await ctxRes.json() as CommitDetail & {
      authorEmail?: string;
      htmlUrl?: string;
      parents?: string[];
      diffTruncated?: boolean;
      prs?: CommitPR[];
    };
    return {
      sha: d.sha ?? sha,
      subject: d.subject ?? '',
      body: d.body ?? '',
      author: d.author ?? '',
      authorEmail: d.authorEmail,
      date: d.date ?? '',
      htmlUrl: d.htmlUrl,
      parents: d.parents ?? [],
      stats: d.stats ?? { additions: 0, deletions: 0, total: 0 },
      diff: d.diff ?? '',
      diffTruncated: d.diffTruncated ?? false,
      files: (d.files ?? []).map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
      prs: d.prs ?? [],
    };
  }

  // Fallback: basic GitHub REST proxy (no PR context, diff capped at 30K)
  const [jsonRes, diffRes] = await Promise.all([
    ghFetch(`repos/${owner}/${repo}/commits/${sha}`),
    ghFetch(`repos/${owner}/${repo}/commits/${sha}`, 'application/vnd.github.diff'),
  ]);
  if (!jsonRes.ok) throw new Error(`commit ${jsonRes.status}`);
  const json = await jsonRes.json() as {
    commit: { message: string; author: { name: string; date: string } };
    html_url?: string;
    stats?: { additions: number; deletions: number; total: number };
    files?: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>;
    parents?: Array<{ sha: string }>;
  };
  const diff = diffRes.ok ? (await diffRes.text()).slice(0, 30_000) : '';
  const [subject, ...rest] = (json.commit.message ?? '').split('\n');
  return {
    sha,
    subject: subject.trim(),
    body: rest.join('\n').trim(),
    author: json.commit.author.name,
    date: json.commit.author.date,
    htmlUrl: json.html_url,
    parents: (json.parents ?? []).map(p => p.sha),
    stats: json.stats ?? { additions: 0, deletions: 0, total: 0 },
    diff,
    files: (json.files ?? []).slice(0, 60).map(f => ({
      filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null,
    })),
    prs: [],
  };
}

async function fetchRepoTree(owner: string, repo: string, sha: string): Promise<RepoTree> {
  const res = await ghFetch(`repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  if (!res.ok) throw new Error(`tree ${res.status}`);
  const json = await res.json() as { sha: string; tree: Array<{ path?: string; type: string }> };
  const files = (json.tree ?? [])
    .filter(e => e.type === 'blob' && e.path)
    .map(e => e.path as string)
    .slice(0, 300);
  return { sha: json.sha, files };
}

async function fetchFileContent(owner: string, repo: string, path: string, ref: string): Promise<string> {
  const res = await ghFetch(`repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`);
  if (!res.ok) throw new Error(`contents ${res.status}`);
  const json = await res.json() as { content?: string; encoding?: string };
  if (json.encoding === 'base64' && json.content) {
    return atob(json.content.replace(/\n/g, ''));
  }
  return '';
}

// ─── Context builder ──────────────────────────────────────────────────────────

export interface KeyFileContent {
  filename: string;
  content: string;
  commitSha: string;
}

export function buildSystemContext(params: {
  repoInfo: RepoInfo | null;
  allCommits: Commit[];
  branches: string[];
  repoTree: RepoTree | null;
  selectedDetails: CommitDetail[];
  attachedFiles: AttachedFile[];
  /** File contents of key changed files — for richer AI context beyond just the diff */
  keyFileContents?: KeyFileContent[];
  /** Max chars of unified diff per commit. Default 80K for "Explain AI" flows. */
  maxDiffChars?: number;
}): string {
  const { repoInfo, allCommits, branches, repoTree, selectedDetails, attachedFiles, keyFileContents, maxDiffChars = 80_000 } = params;

  if (!repoInfo) {
    return [
      'You are an expert software engineering AI assistant.',
      'Help the user understand code, architecture, and engineering decisions.',
      'Be concrete, reference specific code when possible, and explain the "why" not just the "what".',
    ].join(' ');
  }

  const lines: string[] = [
    `You are an expert software engineering AI assistant with deep knowledge of **${repoInfo.fullName}**.`,
    'Your explanations are concrete, reference actual code from the diff, and explain intent and consequences — not just surface-level summaries.',
    '',
    '## Repository',
    `- **Name:** ${repoInfo.fullName}`,
    `- **Default branch:** ${repoInfo.defaultBranch}`,
    repoInfo.description ? `- **Description:** ${repoInfo.description}` : '',
    `- **Commits loaded:** ${allCommits.length}`,
    branches.length > 0
      ? `- **Branches:** ${branches.slice(0, 20).join(', ')}${branches.length > 20 ? ` (+${branches.length - 20} more)` : ''}`
      : '',
    '',
  ].filter(Boolean);

  // Recent commit history (gives the AI temporal context)
  if (allCommits.length > 0) {
    lines.push('## Recent Commit History (newest first)');
    allCommits.slice(0, 25).forEach(c => {
      lines.push(`- \`${c.shortSha}\` **${c.subject}** — _${c.author.name}_ · ${c.author.date.slice(0, 10)}`);
    });
    if (allCommits.length > 25) lines.push(`  _(${allCommits.length - 25} earlier commits omitted)_`);
    lines.push('');
  }

  // File tree (structural context)
  if (repoTree && repoTree.files.length > 0) {
    lines.push('## Repository File Tree');
    lines.push('```');
    repoTree.files.slice(0, 200).forEach(f => lines.push(f));
    if (repoTree.files.length > 200) lines.push(`... +${repoTree.files.length - 200} more files`);
    lines.push('```');
    lines.push('');
  } else if (!repoTree) {
    lines.push('_(Repository file tree not yet loaded — structural context unavailable)_');
    lines.push('');
  }

  // Deep commit details — the heart of the explanation context
  if (selectedDetails.length > 0) {
    lines.push('## Commit Detail(s) — Complete Context for Your Analysis');
    lines.push('');

    selectedDetails.forEach((d, idx) => {
      if (selectedDetails.length > 1) lines.push(`---\n### Commit ${idx + 1} of ${selectedDetails.length}`);

      lines.push(`## \`${d.sha.slice(0, 7)}\` — ${d.subject}`);
      lines.push('');
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| **SHA** | \`${d.sha}\` |`);
      lines.push(`| **Author** | ${d.author}${d.authorEmail ? ` <${d.authorEmail}>` : ''} |`);
      lines.push(`| **Date** | ${d.date.slice(0, 19).replace('T', ' ')} UTC |`);
      if (d.htmlUrl) lines.push(`| **GitHub** | ${d.htmlUrl} |`);
      lines.push(`| **Changes** | +${d.stats.additions} additions, −${d.stats.deletions} deletions, ${d.files.length} file(s) |`);
      if (d.parents?.length) lines.push(`| **Parents** | ${d.parents.map(p => `\`${p.slice(0,7)}\``).join(', ')} |`);
      lines.push('');

      // Commit message body (contains "why" the change was made)
      if (d.body) {
        lines.push('### Commit Message Body');
        lines.push('');
        lines.push(d.body);
        lines.push('');
      }

      // Associated PRs — critical for understanding intent
      if (d.prs && d.prs.length > 0) {
        lines.push('### Associated Pull Request(s)');
        lines.push('');
        d.prs.forEach(pr => {
          lines.push(`#### PR #${pr.number}: ${pr.title}`);
          lines.push(`- **State:** ${pr.state}${pr.mergedAt ? ` (merged ${pr.mergedAt.slice(0,10)})` : ''}`);
          lines.push(`- **Author:** ${pr.author}`);
          if (pr.baseBranch && pr.headBranch) {
            lines.push(`- **Branch:** \`${pr.headBranch}\` → \`${pr.baseBranch}\``);
          }
          if (pr.labels.length > 0) lines.push(`- **Labels:** ${pr.labels.join(', ')}`);
          lines.push(`- **URL:** ${pr.htmlUrl}`);
          if (pr.body.trim()) {
            lines.push('');
            lines.push('**PR Description:**');
            lines.push('');
            // Trim very long PR descriptions but keep the intent visible
            const trimmedBody = pr.body.length > 4_000
              ? pr.body.slice(0, 4_000) + '\n... _(description truncated)_'
              : pr.body;
            lines.push(trimmedBody);
          }
          lines.push('');
        });
      }

      // Files changed (structural overview)
      if (d.files.length > 0) {
        lines.push('### Files Changed');
        lines.push('');
        lines.push('| File | Status | +Added | −Removed |');
        lines.push('|------|--------|--------|----------|');
        d.files.forEach(f => {
          lines.push(`| \`${f.filename}\` | ${f.status} | +${f.additions} | −${f.deletions} |`);
        });
        lines.push('');
      }

      // Full unified diff — the most valuable context for understanding what changed
      if (d.diff) {
        lines.push('### Full Unified Diff');
        if (d.diffTruncated) {
          lines.push('> ⚠️ This diff was truncated server-side due to size. The most significant changes are shown.');
        }
        lines.push('');
        lines.push('```diff');
        const diffToShow = d.diff.length > maxDiffChars
          ? d.diff.slice(0, maxDiffChars) + `\n... (${d.diff.length - maxDiffChars} more chars truncated)`
          : d.diff;
        lines.push(diffToShow);
        lines.push('```');
        lines.push('');
      }
    });
  }

  // Key file contents — full source of the most-changed files at the commit SHA.
  // This lets the AI understand surrounding context beyond the diff's ±3 lines.
  if (keyFileContents && keyFileContents.length > 0) {
    lines.push('## Key Changed File Contents (at commit SHA)');
    lines.push('_Full file source at the time of the commit — use this to understand surrounding context._');
    lines.push('');
    keyFileContents.forEach(fc => {
      lines.push(`### \`${fc.filename}\` (@ \`${fc.commitSha.slice(0, 7)}\`)`);
      const ext = fc.filename.split('.').pop() ?? '';
      lines.push(`\`\`\`${ext}`);
      const body = fc.content.length > 6_000 ? fc.content.slice(0, 6_000) + '\n... (truncated)' : fc.content;
      lines.push(body);
      lines.push('```');
      lines.push('');
    });
  }

  // Attached files from the repo browser
  if (attachedFiles.length > 0) {
    lines.push('## Attached File Contents');
    attachedFiles.forEach(f => {
      lines.push(`### \`${f.path}\``);
      lines.push('```');
      const body = f.content.length > 10_000 ? f.content.slice(0, 10_000) + '\n... (truncated)' : f.content;
      lines.push(body);
      lines.push('```');
      lines.push('');
    });
  }

  lines.push('---');
  lines.push(
    'Use this full context to give a thorough, accurate explanation. ' +
    'Reference specific files, line changes, and the PR description when available. ' +
    'Explain what changed, why it changed, and what the impact/risks are. ' +
    'Use 7-char SHAs. Use markdown code blocks for diffs and code snippets.',
  );

  return lines.join('\n');
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseGitHubContextResult {
  repoTree: RepoTree | null;
  treeLoading: boolean;
  commitDetails: Map<string, CommitDetail>;
  detailLoading: boolean;
  attachedFiles: AttachedFile[];
  loadSelectedCommits: (nodes: GraphNode[], repoInfo: RepoInfo) => Promise<CommitDetail[]>;
  /** Fetch commit details by SHA directly — works even when the commit is not in the loaded graph. */
  loadDetailsByShas: (shas: string[], repoInfo: RepoInfo) => Promise<CommitDetail[]>;
  /**
   * Fetch full source of the top N most-changed files for each commit detail.
   * Returns up to 3 files per commit (max 2 commits) to keep token usage bounded.
   */
  fetchKeyFileContents: (details: CommitDetail[], repoInfo: RepoInfo) => Promise<KeyFileContent[]>;
  loadRepoTree: (repoInfo: RepoInfo) => Promise<void>;
  attachFile: (path: string, ref: string, repoInfo: RepoInfo) => Promise<void>;
  removeFile: (path: string) => void;
  buildContext: (params: {
    repoInfo: RepoInfo | null;
    allCommits: Commit[];
    branches: string[];
    selectedNodes: GraphNode[];
    overrideDetails?: CommitDetail[];
    keyFileContents?: KeyFileContent[];
    maxDiffChars?: number;
  }) => string;
}

export function useGitHubContext(): UseGitHubContextResult {
  const [repoTree, setRepoTree] = useState<RepoTree | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [commitDetails, setCommitDetails] = useState<Map<string, CommitDetail>>(new Map());
  const [detailLoading, setDetailLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  // ── Live refs — updated synchronously during render so callbacks can read
  //    the latest values without listing them in their dependency arrays.
  //    This is the canonical pattern for breaking the "state change → new
  //    callback reference → effect re-fires" cycle that caused infinite loops.
  const commitDetailsRef = useRef(commitDetails);
  const repoTreeRef = useRef(repoTree);
  const attachedFilesRef = useRef(attachedFiles);
  commitDetailsRef.current = commitDetails;
  repoTreeRef.current = repoTree;
  attachedFilesRef.current = attachedFiles;

  // Track SHAs that permanently failed (404 / API error) to prevent retries.
  const failedShasRef = useRef<Set<string>>(new Set());
  // Guard for loadRepoTree — avoids duplicate in-flight requests.
  const lastTreeKeyRef = useRef('');
  const treeLoadingRef = useRef(false);

  // ── loadSelectedCommits — stable reference (empty deps) ───────────────────
  // Returns CommitDetail[] for all requested nodes (freshly fetched + cached).
  // Callers can use the return value directly to bypass the stale-ref timing
  // issue that occurs when the result is only read via commitDetailsRef after
  // a React state-update cycle.
  const loadSelectedCommits = useCallback(async (
    nodes: GraphNode[],
    repoInfo: RepoInfo,
  ): Promise<CommitDetail[]> => {
    const missing = nodes.filter(n =>
      !commitDetailsRef.current.has(n.commit.sha) &&
      !failedShasRef.current.has(n.commit.sha),
    );

    // Collect freshly fetched details so we can return them directly without
    // waiting for React to flush the setCommitDetails state update.
    const fetched: Array<{ sha: string; detail: CommitDetail }> = [];

    if (missing.length > 0) {
      setDetailLoading(true);
      try {
        const results = await Promise.allSettled(
          missing.map(n => fetchCommitDetail(repoInfo.owner, repoInfo.repo, n.commit.sha)),
        );
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') {
            fetched.push({ sha: missing[i].commit.sha, detail: r.value });
          } else {
            // Mark as permanently failed — don't retry on next render
            failedShasRef.current.add(missing[i].commit.sha);
            console.warn(
              `[useGitHubContext] commit ${missing[i].commit.sha.slice(0, 7)} fetch failed:`,
              r.reason,
            );
          }
        });
        if (fetched.length > 0) {
          setCommitDetails(prev => {
            const next = new Map(prev);
            fetched.forEach(({ sha, detail }) => next.set(sha, detail));
            return next;
          });
        }
      } finally {
        setDetailLoading(false);
      }
    }

    // Build return value: freshly fetched takes priority over cached ref
    // (ref may not yet reflect the setCommitDetails update above)
    const freshMap = new Map(fetched.map(({ sha, detail }) => [sha, detail]));
    return nodes
      .map(n => freshMap.get(n.commit.sha) ?? commitDetailsRef.current.get(n.commit.sha))
      .filter((d): d is CommitDetail => !!d);
  }, []); // intentionally empty — reads live state via commitDetailsRef

  // ── loadRepoTree — stable reference (empty deps) ──────────────────────────
  const loadRepoTree = useCallback(async (repoInfo: RepoInfo): Promise<void> => {
    const key = `${repoInfo.fullName}@${repoInfo.defaultBranch}`;
    // Use ref-based guard to avoid triggering re-renders as a side-effect of
    // the boolean check (which is why treeLoading state is NOT in deps here).
    if (lastTreeKeyRef.current === key || treeLoadingRef.current) return;
    lastTreeKeyRef.current = key;
    treeLoadingRef.current = true;
    setTreeLoading(true);
    try {
      const tree = await fetchRepoTree(repoInfo.owner, repoInfo.repo, repoInfo.defaultBranch);
      setRepoTree(tree);
    } catch (e) {
      console.warn('[useGitHubContext] tree fetch failed:', e);
      lastTreeKeyRef.current = ''; // allow retry on next mount
    } finally {
      treeLoadingRef.current = false;
      setTreeLoading(false);
    }
  }, []); // intentionally empty

  // ── attachFile — stable reference (empty deps) ────────────────────────────
  const attachFile = useCallback(async (
    path: string,
    ref: string,
    repoInfo: RepoInfo,
  ): Promise<void> => {
    if (attachedFilesRef.current.some(f => f.path === path)) return;
    try {
      const content = await fetchFileContent(repoInfo.owner, repoInfo.repo, path, ref);
      setAttachedFiles(prev => [...prev, { path, content, ref }]);
    } catch (e) {
      console.warn('[useGitHubContext] file fetch failed:', e);
    }
  }, []); // intentionally empty — reads live state via attachedFilesRef

  // ── removeFile — stable reference ─────────────────────────────────────────
  const removeFile = useCallback((path: string) => {
    setAttachedFiles(prev => prev.filter(f => f.path !== path));
  }, []);

  // ── loadDetailsByShas — fetch commit details by SHA without GraphNodes ───────
  // This handles the case where the commit is NOT in the currently loaded graph
  // (e.g. older commit, different branch, or graph not yet loaded). Stores results
  // in the same commitDetailsRef/state cache as loadSelectedCommits.
  const loadDetailsByShas = useCallback(async (
    shas: string[],
    repoInfo: RepoInfo,
  ): Promise<CommitDetail[]> => {
    const toFetch = shas.filter(
      sha => !commitDetailsRef.current.has(sha) && !failedShasRef.current.has(sha),
    );
    const fetched: Array<{ sha: string; detail: CommitDetail }> = [];

    if (toFetch.length > 0) {
      const results = await Promise.allSettled(
        toFetch.map(sha => fetchCommitDetail(repoInfo.owner, repoInfo.repo, sha)),
      );
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          fetched.push({ sha: toFetch[i], detail: r.value });
        } else {
          failedShasRef.current.add(toFetch[i]);
          console.warn(
            `[useGitHubContext] SHA ${toFetch[i].slice(0, 7)} direct-fetch failed:`,
            r.reason,
          );
        }
      });
      if (fetched.length > 0) {
        setCommitDetails(prev => {
          const next = new Map(prev);
          fetched.forEach(({ sha, detail }) => next.set(sha, detail));
          return next;
        });
      }
    }

    const freshMap = new Map(fetched.map(({ sha, detail }) => [sha, detail]));
    return shas
      .map(sha => freshMap.get(sha) ?? commitDetailsRef.current.get(sha))
      .filter((d): d is CommitDetail => !!d);
  }, []); // intentionally empty — reads live state via refs

  // ── fetchKeyFileContents — stable reference (empty deps) ─────────────────
  // Fetches the full source of the top 3 most-changed files per commit (max 2
  // commits) so the AI has surrounding code context beyond the ±3-line diff.
  // Only fetches non-removed files. Results are NOT cached — callers should
  // call this once per send and pass the result directly to buildContext.
  const fetchKeyFileContents = useCallback(async (
    details: CommitDetail[],
    repoInfo: RepoInfo,
  ): Promise<KeyFileContent[]> => {
    const results: KeyFileContent[] = [];
    // Limit to first 2 commits to avoid excessive API calls
    for (const detail of details.slice(0, 2)) {
      const topFiles = detail.files
        .filter(f => f.status !== 'removed' && (f.additions + f.deletions) > 0)
        .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
        .slice(0, 3); // top 3 most-changed files per commit
      const fetched = await Promise.allSettled(
        topFiles.map(async f => {
          const content = await fetchFileContent(repoInfo.owner, repoInfo.repo, f.filename, detail.sha);
          return { filename: f.filename, content, commitSha: detail.sha };
        }),
      );
      for (const r of fetched) {
        if (r.status === 'fulfilled' && r.value.content) results.push(r.value);
      }
    }
    return results;
  }, []); // intentionally empty — no state deps

  // ── buildContext — stable reference (empty deps) ──────────────────────────
  const buildContext = useCallback((params: {
    repoInfo: RepoInfo | null;
    allCommits: Commit[];
    branches: string[];
    selectedNodes: GraphNode[];
    /** When provided and non-empty, bypasses the stale commitDetailsRef. */
    overrideDetails?: CommitDetail[];
    keyFileContents?: KeyFileContent[];
    maxDiffChars?: number;
  }): string => {
    // Treat overrideDetails = [] the same as absent — fall back to graph-node lookup.
    // An empty override array means "details weren't fetched yet", not "no details needed".
    const selectedDetails = (params.overrideDetails && params.overrideDetails.length > 0)
      ? params.overrideDetails
      : params.selectedNodes
          .map(n => commitDetailsRef.current.get(n.commit.sha))
          .filter((d): d is CommitDetail => !!d);
    return buildSystemContext({
      repoInfo: params.repoInfo,
      allCommits: params.allCommits,
      branches: params.branches,
      repoTree: repoTreeRef.current,
      selectedDetails,
      attachedFiles: attachedFilesRef.current,
      keyFileContents: params.keyFileContents,
      maxDiffChars: params.maxDiffChars,
    });
  }, []); // intentionally empty — reads live state via refs

  return {
    repoTree,
    treeLoading,
    commitDetails,
    detailLoading,
    attachedFiles,
    loadSelectedCommits,
    loadDetailsByShas,
    fetchKeyFileContents,
    loadRepoTree,
    attachFile,
    removeFile,
    buildContext,
  };
}
