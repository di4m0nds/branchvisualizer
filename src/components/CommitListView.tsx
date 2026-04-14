import { useMemo, useCallback, useState, useRef, type CSSProperties } from 'react';
import { useAppContext } from '@/store/AppContext';
import AuthorPopup, { useAnchorRect } from '@/components/AuthorPopup';
import type { GraphNode, Commit } from '@/types';
import { hashColor, getInitials, timeAgo, cn } from '@/lib/utils';

// ─── Branch/tag reachability (mirrors GraphCanvas logic) ──────────────────────

function reachableFromTip(tipSha: string, commitMap: Map<string, GraphNode>): Set<string> {
  const visited = new Set<string>();
  const stack = [tipSha];
  while (stack.length > 0) {
    const sha = stack.pop()!;
    if (visited.has(sha)) continue;
    visited.add(sha);
    const node = commitMap.get(sha);
    if (node) for (const p of node.commit.parents) stack.push(p);
  }
  return visited;
}

function applyFilter(
  commits: Commit[],
  filter: { search: string; branch: string; author: string; dateFrom: string; dateTo: string },
  commitMap: Map<string, GraphNode>,
  branches: { name: string; sha: string }[],
): Commit[] {
  const hasFilter = filter.search || filter.branch || filter.author || filter.dateFrom || filter.dateTo;
  if (!hasFilter) return commits;

  const search   = filter.search.toLowerCase();
  const dateFrom = filter.dateFrom ? new Date(filter.dateFrom).getTime() : 0;
  const dateTo   = filter.dateTo   ? new Date(filter.dateTo + 'T23:59:59').getTime() : Infinity;

  let branchReachable: Set<string> | null = null;
  if (filter.branch) {
    const tip = branches.find(b => b.name === filter.branch)?.sha;
    branchReachable = tip ? reachableFromTip(tip, commitMap) : new Set();
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

// ─── Author cell ──────────────────────────────────────────────────────────────

function AuthorCell({ commit }: { commit: Commit }) {
  const [showPopup, setShowPopup] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const anchorRect = useAnchorRect(showPopup, anchorRef);
  const { author } = commit;
  const color = hashColor(author.name);
  const initials = getInitials(author.name);

  return (
    <div
      ref={anchorRef}
      className="flex items-center gap-1.5 min-w-0"
      onMouseEnter={() => setShowPopup(true)}
      onMouseLeave={() => setShowPopup(false)}
    >
      {author.avatarUrl ? (
        <img src={author.avatarUrl} alt={author.name}
          className="w-5 h-5 rounded-full border border-border flex-shrink-0" />
      ) : (
        <div
          className="w-5 h-5 rounded-full border flex-shrink-0 flex items-center justify-center
                     text-[9px] font-semibold"
          style={{ background: `${color}22`, color, borderColor: `${color}60` }}
        >
          {initials}
        </div>
      )}
      <span className="truncate text-xs text-muted-foreground hidden sm:block">
        {author.login ?? author.name.split(' ')[0]}
      </span>
      {showPopup && anchorRect && <AuthorPopup author={author} anchorRect={anchorRect} />}
    </div>
  );
}

// ─── Single commit row ────────────────────────────────────────────────────────

interface CommitRowProps {
  node: GraphNode;
  isSelected: boolean;
  isDimmed: boolean;
  onSelect: (node: GraphNode) => void;
  branchMap: Map<string, { name: string; isDefault: boolean; isRemote: boolean }[]>;
  tagMap:    Map<string, { name: string }[]>;
}

function CommitRow({ node, isSelected, isDimmed, onSelect, branchMap, tagMap }: CommitRowProps) {
  const { commit, color } = node;
  const nodeBranches = branchMap.get(commit.sha) ?? [];
  const nodeTags     = tagMap.get(commit.sha)    ?? [];

  const handleClick = useCallback(() => onSelect(node), [node, onSelect]);

  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-4 py-2.5 border-b border-border/60',
        'cursor-pointer hover:bg-accent/30 transition-colors duration-100',
        isSelected && 'bg-accent/50 hover:bg-accent/60',
        isDimmed   && 'opacity-30',
      )}
      style={{ '--row-color': color } as CSSProperties}
      onClick={handleClick}
      role="row"
      aria-selected={isSelected}
    >
      {/* Lane color indicator */}
      <div
        className="w-0.5 self-stretch rounded-full flex-shrink-0 opacity-70"
        style={{ background: color }}
      />

      {/* SHA */}
      <code
        className="text-[11px] font-mono text-muted-foreground/80 flex-shrink-0 w-14 tabular-nums
                   group-hover:text-foreground transition-colors"
        title={commit.sha}
      >
        {commit.shortSha}
      </code>

      {/* Merge icon */}
      {commit.isMerge && (
        <div className="flex-shrink-0 w-4 h-4 rounded-sm flex items-center justify-center
                        bg-purple-500/15 text-purple-400" title="Merge commit">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
            <circle cx="1.5" cy="1.5" r="1.5"/>
            <circle cx="6.5" cy="1.5" r="1.5"/>
            <circle cx="1.5" cy="6.5" r="1.5"/>
            <path d="M1.5 3v.5C1.5 5.43 3.07 7 5 7h1.5" stroke="currentColor" strokeWidth="1" fill="none"/>
            <line x1="6.5" y1="3" x2="1.5" y2="3" stroke="currentColor" strokeWidth="1"/>
          </svg>
        </div>
      )}

      {/* Subject */}
      <span className="flex-1 min-w-0 text-sm text-foreground truncate leading-tight">
        {commit.subject}
      </span>

      {/* Badges */}
      <div className="hidden md:flex items-center gap-1 flex-shrink-0">
        {nodeBranches.slice(0, 2).map(b => (
          <span
            key={b.name}
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium
                       border truncate max-w-[100px]"
            style={{
              color,
              borderColor: `${color}50`,
              background: `${color}12`,
            }}
            title={b.name}
          >
            {b.name}
          </span>
        ))}
        {nodeBranches.length > 2 && (
          <span className="text-[10px] text-muted-foreground">+{nodeBranches.length - 2}</span>
        )}
        {nodeTags.slice(0, 1).map(t => (
          <span
            key={t.name}
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium
                       bg-amber-500/10 border border-amber-500/30 text-amber-500 truncate max-w-[80px]"
            title={t.name}
          >
            🏷 {t.name}
          </span>
        ))}
      </div>

      {/* Author */}
      <AuthorCell commit={commit} />

      {/* Time */}
      <span
        className="text-xs text-muted-foreground flex-shrink-0 tabular-nums w-16 text-right hidden sm:block"
        title={new Date(commit.author.date).toLocaleString()}
      >
        {timeAgo(commit.author.date)}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

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
    dispatch({
      type: 'SELECT_NODE',
      node: selectedNode?.commit.sha === node.commit.sha ? null : node,
    });
  }, [dispatch, selectedNode]);

  if (!graphData) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground py-16">
        <span className="text-3xl">⑂</span>
        <span className="text-sm">No repository loaded</span>
      </div>
    );
  }

  if (filteredCommits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground py-16">
        <span className="text-3xl">🔍</span>
        <span className="text-sm">No commits match your filter</span>
      </div>
    );
  }

  const nodes = filteredCommits
    .map(c => graphData.commitMap.get(c.sha))
    .filter((n): n is GraphNode => !!n);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border
                      bg-muted/30 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground
                      flex-shrink-0">
        <div className="w-0.5 flex-shrink-0" />
        <span className="w-14 flex-shrink-0">SHA</span>
        <span className="flex-1">Message</span>
        <span className="hidden md:block w-32">Branches / Tags</span>
        <span className="hidden sm:block w-20 text-center">Author</span>
        <span className="hidden sm:block w-16 text-right">When</span>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto" role="grid">
        {nodes.map(node => (
          <CommitRow
            key={node.commit.sha}
            node={node}
            isSelected={selectedNode?.commit.sha === node.commit.sha}
            isDimmed={highlightedShas !== null && !highlightedShas.has(node.commit.sha)}
            onSelect={handleSelect}
            branchMap={graphData.branchMap}
            tagMap={graphData.tagMap}
          />
        ))}
      </div>

      {/* Count bar */}
      <div className="flex items-center px-4 py-2 border-t border-border bg-muted/20
                      text-xs text-muted-foreground flex-shrink-0">
        Showing {nodes.length.toLocaleString()} of {allCommits.length.toLocaleString()} commits
      </div>
    </div>
  );
}
