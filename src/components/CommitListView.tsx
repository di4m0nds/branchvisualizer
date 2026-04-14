import React, { useMemo, useState, useCallback } from 'react';
import { useAppContext } from '../store/AppContext';
import AuthorPopup from './AuthorPopup';
import type { GraphNode, Commit } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function hashColor(str: string): string {
  const palette = [
    '#00e5ff', '#00d4aa', '#a855f7', '#3b82f6',
    '#f472b6', '#10b981', '#f59e0b', '#60a5fa',
    '#34d399', '#e879f9', '#fb923c', '#38bdf8',
  ];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return palette[Math.abs(h) % palette.length];
}

// ─── Filter logic (mirrors GraphCanvas highlight logic) ───────────────────

function reachableFromTip(
  tipSha: string,
  commitMap: Map<string, GraphNode>,
): Set<string> {
  const visited = new Set<string>();
  const stack = [tipSha];
  while (stack.length > 0) {
    const sha = stack.pop()!;
    if (visited.has(sha)) continue;
    visited.add(sha);
    const node = commitMap.get(sha);
    if (node) {
      for (const p of node.commit.parents) stack.push(p);
    }
  }
  return visited;
}

function applyFilter(
  commits: Commit[],
  filter: { search: string; branch: string; author: string; dateFrom: string; dateTo: string },
  graphNode: Map<string, GraphNode> | undefined,
  branches: { name: string; sha: string }[],
): Commit[] {
  const hasFilter = filter.search || filter.branch || filter.author || filter.dateFrom || filter.dateTo;
  if (!hasFilter) return commits;

  const search   = filter.search.toLowerCase();
  const dateFrom = filter.dateFrom ? new Date(filter.dateFrom).getTime() : 0;
  const dateTo   = filter.dateTo   ? new Date(filter.dateTo + 'T23:59:59').getTime() : Infinity;

  let branchReachable: Set<string> | null = null;
  if (filter.branch && graphNode) {
    const tip = branches.find(b => b.name === filter.branch)?.sha;
    branchReachable = tip ? reachableFromTip(tip, graphNode) : new Set();
  }

  return commits.filter(c => {
    if (branchReachable && !branchReachable.has(c.sha)) return false;
    if (filter.author) {
      const key = c.author.login || c.author.email;
      if (key !== filter.author) return false;
    }
    if (dateFrom || dateTo < Infinity) {
      const t = new Date(c.author.date).getTime();
      if (t < dateFrom || t > dateTo) return false;
    }
    if (search) {
      const combined = `${c.sha} ${c.subject} ${c.body} ${c.author.name} ${c.author.login ?? ''}`.toLowerCase();
      if (!combined.includes(search)) return false;
    }
    return true;
  });
}

// ─── Author cell with hover popup ─────────────────────────────────────────

function AuthorCell({ commit }: { commit: Commit }) {
  const [showPopup, setShowPopup] = useState(false);
  const { author } = commit;
  const color = hashColor(author.name);
  const initial = author.name.charAt(0).toUpperCase();

  return (
    <div className="commit-row-author">
      {author.avatarUrl ? (
        <img src={author.avatarUrl} alt={author.name} className="commit-author-avatar" />
      ) : (
        <div
          className="commit-author-initial"
          style={{ background: `${color}22`, color, borderColor: color }}
        >
          {initial}
        </div>
      )}
      <div
        className="author-popup-wrapper"
        style={{ flex: 1, minWidth: 0 }}
        onMouseEnter={() => setShowPopup(true)}
        onMouseLeave={() => setShowPopup(false)}
      >
        <span className="commit-author-name">{author.name}</span>
        {showPopup && <AuthorPopup author={author} />}
      </div>
    </div>
  );
}

// ─── Single commit row ────────────────────────────────────────────────────

interface CommitRowProps {
  node: GraphNode;
  isSelected: boolean;
  isDimmed: boolean;
  onSelect: (node: GraphNode) => void;
  branchMap: Map<string, { name: string; isDefault: boolean }[]>;
}

function CommitRow({ node, isSelected, isDimmed, onSelect, branchMap }: CommitRowProps) {
  const { commit, color } = node;
  const branchesOnCommit = branchMap.get(commit.sha) ?? [];

  const handleClick = useCallback(() => onSelect(node), [node, onSelect]);

  return (
    <div
      className={[
        'commit-row',
        isSelected ? 'commit-row--selected' : '',
        isDimmed   ? 'commit-row--dimmed'   : '',
        commit.isMerge ? 'commit-row--merge' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--row-accent': color } as React.CSSProperties}
      onClick={handleClick}
      role="row"
      aria-selected={isSelected}
    >
      {/* SHA */}
      <span className="commit-row-sha" title={commit.sha}>
        {commit.shortSha}
      </span>

      {/* Message */}
      <span className="commit-row-message" title={commit.subject}>
        {commit.subject}
      </span>

      {/* Author */}
      <AuthorCell commit={commit} />

      {/* Time */}
      <span className="commit-row-time" title={new Date(commit.author.date).toLocaleString()}>
        {timeAgo(commit.author.date)}
      </span>

      {/* Branch tags */}
      <div className="commit-row-branch">
        {branchesOnCommit.slice(0, 1).map(b => (
          <span
            key={b.name}
            className="commit-branch-tag"
            style={{ color, borderColor: `${color}60`, background: `${color}12` }}
            title={b.name}
          >
            {b.name}
          </span>
        ))}
        {branchesOnCommit.length > 1 && (
          <span
            className="commit-branch-tag"
            style={{ color, borderColor: `${color}40`, background: `${color}0a` }}
          >
            +{branchesOnCommit.length - 1}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export default function CommitListView() {
  const { state, dispatch } = useAppContext();
  const { graphData, filter, selectedNode, branches, allCommits } = state;

  const filteredCommits = useMemo(() => {
    if (!graphData) return [];
    return applyFilter(allCommits, filter, graphData.commitMap, branches);
  }, [allCommits, filter, graphData, branches]);

  const highlightedShas = useMemo<Set<string> | null>(() => {
    const hasFilter = filter.search || filter.branch || filter.author || filter.dateFrom || filter.dateTo;
    if (!hasFilter) return null;
    return new Set(filteredCommits.map(c => c.sha));
  }, [filteredCommits, filter]);

  const handleSelect = useCallback((node: GraphNode) => {
    dispatch({ type: 'SELECT_NODE', node: selectedNode?.commit.sha === node.commit.sha ? null : node });
  }, [dispatch, selectedNode]);

  if (!graphData) {
    return (
      <div className="commit-list-view">
        <div className="commit-list-empty">
          <span style={{ fontSize: 28 }}>⑂</span>
          No repository loaded
        </div>
      </div>
    );
  }

  if (filteredCommits.length === 0) {
    return (
      <div className="commit-list-view">
        <div className="commit-list-empty">
          <span style={{ fontSize: 28 }}>🔍</span>
          No commits match your filter
        </div>
      </div>
    );
  }

  // Map commits to their graph nodes for color info
  const nodes = filteredCommits
    .map(c => graphData.commitMap.get(c.sha))
    .filter((n): n is GraphNode => !!n);

  return (
    <div className="commit-list-view">
      {/* Header row */}
      <div className="commit-list-header">
        <span className="commit-list-header-cell">SHA</span>
        <span className="commit-list-header-cell">Message</span>
        <span className="commit-list-header-cell">Author</span>
        <span className="commit-list-header-cell">When</span>
        <span className="commit-list-header-cell">Branch</span>
      </div>

      {/* Scrollable commit rows */}
      <div className="commit-list-scroll" role="grid">
        {nodes.map(node => (
          <CommitRow
            key={node.commit.sha}
            node={node}
            isSelected={selectedNode?.commit.sha === node.commit.sha}
            isDimmed={highlightedShas !== null && !highlightedShas.has(node.commit.sha)}
            onSelect={handleSelect}
            branchMap={graphData.branchMap}
          />
        ))}
      </div>
    </div>
  );
}
