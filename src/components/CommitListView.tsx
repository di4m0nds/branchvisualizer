import React, {
  useMemo, useCallback, useState, useRef, useEffect,
  type CSSProperties,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppSelector, useAppDispatch } from '@/store/store';
import AuthorPopup, { useAnchorRect } from '@/components/AuthorPopup';
import DetailPanel from '@/components/DetailPanel';
import type { GraphNode, Commit } from '@/types';
import { hashColor, getInitials, timeAgo, cn } from '@/lib/utils';

// ─── Branch/tag reachability ───────────────────────────────────────────────────

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

  const search = filter.search.toLowerCase();
  const dateFrom = filter.dateFrom ? new Date(filter.dateFrom).getTime() : 0;
  const dateTo = filter.dateTo ? new Date(filter.dateTo + 'T23:59:59').getTime() : Infinity;

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

// ─── Extract PR number from merge commit message ───────────────────────────────

function extractPRNumber(subject: string, body: string): string | null {
  const combined = `${subject} ${body}`;
  // Match "Merge pull request #123", "(#456)", "PR #789", plain "#123"
  const m = combined.match(/(?:pull\s+request\s+#|pr\s*#|\(#|(?:^|\s)#)(\d+)/i);
  return m ? m[1] : null;
}

// ─── Author cell ───────────────────────────────────────────────────────────────

function AuthorCell({ commit }: { commit: Commit }) {
  const [showPopup, setShowPopup] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const anchorRect = useAnchorRect(showPopup, anchorRef);
  const { author } = commit;
  const color = hashColor(author.name);
  const initials = getInitials(author.name);
  const profileUrl = author.login ? `https://github.com/${author.login}` : null;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (profileUrl) window.open(profileUrl, '_blank', 'noreferrer');
  }

  return (
    <div
      ref={anchorRef}
      className={`flex items-center gap-1.5 min-w-0 rounded
                 ${profileUrl ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
      onMouseEnter={() => setShowPopup(true)}
      onMouseLeave={() => setShowPopup(false)}
      onClick={handleClick}
      title={profileUrl ? `View @${author.login} on GitHub` : author.name}
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

// ─── Merge icon (bigger, with optional PR link) ───────────────────────────────

function MergeIcon({ prNumber, repoUrl }: { prNumber: string | null; repoUrl: string | null }) {
  const iconSvg = (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="currentColor">
      <circle cx="1.8" cy="1.8" r="1.6" />
      <circle cx="8.2" cy="1.8" r="1.6" />
      <circle cx="1.8" cy="8.2" r="1.6" />
      <path d="M1.8 3.4v.6C1.8 5.8 3.4 7.2 5.2 7.2h3" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round"/>
      <line x1="8.2" y1="3.4" x2="1.8" y2="3.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );

  const classes = cn(
    'flex-shrink-0 w-5 h-5 rounded flex items-center justify-center',
    'bg-purple-500/15 text-purple-400',
    prNumber && 'hover:bg-purple-500/30 transition-colors',
  );

  if (prNumber && repoUrl) {
    return (
      <a
        href={`${repoUrl}/pull/${prNumber}`}
        target="_blank"
        rel="noreferrer"
        onClick={e => e.stopPropagation()}
        className={classes}
        title={`View PR #${prNumber} on GitHub`}
      >
        {iconSvg}
      </a>
    );
  }

  return (
    <div className={classes} title="Merge commit">
      {iconSvg}
    </div>
  );
}

// ─── Single commit row ─────────────────────────────────────────────────────────

interface CommitRowProps {
  node: GraphNode;
  isSelected: boolean;
  isDimmed: boolean;
  onSelect: (node: GraphNode, shiftHeld: boolean) => void;
  branchMap: Map<string, { name: string; isDefault: boolean; isRemote: boolean }[]>;
  tagMap: Map<string, { name: string }[]>;
  repoUrl: string | null;
}

function CommitRow({ node, isSelected, isDimmed, onSelect, branchMap, tagMap, repoUrl }: CommitRowProps) {
  const { commit, color } = node;
  const nodeBranches = branchMap.get(commit.sha) ?? [];
  const nodeTags = tagMap.get(commit.sha) ?? [];
  const prNumber = commit.isMerge ? extractPRNumber(commit.subject, commit.body) : null;

  const [hovered, setHovered] = useState(false);
  const handleClick = useCallback((e: React.MouseEvent) => onSelect(node, e.shiftKey), [node, onSelect]);

  const bgStyle: CSSProperties = {};
  if (isSelected) {
    bgStyle.backgroundColor = `${color}1a`;
  } else if (hovered) {
    bgStyle.backgroundColor = `${color}10`;
  }

  return (
    <div
      data-sha={commit.sha}
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 border-b border-border/60',
        'cursor-pointer transition-colors duration-75',
        isDimmed && 'opacity-30',
      )}
      style={bgStyle}
      onClick={(e) => handleClick(e)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
                   hover:text-foreground transition-colors"
        title={commit.sha}
      >
        {commit.shortSha}
      </code>

      {/* Merge icon */}
      {commit.isMerge && (
        <MergeIcon prNumber={prNumber} repoUrl={repoUrl} />
      )}

      {/* Subject — merge commits link to the PR */}
      {commit.isMerge && prNumber && repoUrl ? (
        <a
          href={`${repoUrl}/pull/${prNumber}`}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex-1 min-w-0 text-sm text-purple-400 hover:text-purple-300 truncate leading-tight
                     hover:underline transition-colors"
          title={`Open PR #${prNumber} on GitHub`}
        >
          {commit.subject}
        </a>
      ) : (
        <span className="flex-1 min-w-0 text-sm text-foreground truncate leading-tight">
          {commit.subject}
        </span>
      )}

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

// ─── Pagination controls ───────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (ps: number) => void;
}

function Pagination({ page, pageSize, total, onPage, onPageSize }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize + 1;
  const end   = Math.min((page + 1) * pageSize, total);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t border-border bg-muted/20 flex-shrink-0 flex-wrap">
      {/* Count */}
      <span className="text-xs text-muted-foreground tabular-nums flex-1 min-w-0">
        {start}–{end} of {total.toLocaleString()} commits
      </span>

      {/* Page size selector */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground hidden sm:block">Per page:</span>
        <div className="flex items-center rounded border border-border overflow-hidden">
          {PAGE_SIZE_OPTIONS.map(size => (
            <button
              key={size}
              className={cn(
                'px-2 py-0.5 text-[11px] font-mono transition-colors',
                pageSize === size
                  ? 'bg-accent text-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
              onClick={() => { onPageSize(size); onPage(0); }}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Prev / Next */}
      <div className="flex items-center gap-1">
        <button
          className="w-7 h-6 flex items-center justify-center rounded border border-border
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors
                     disabled:opacity-30 disabled:cursor-not-allowed text-xs"
          onClick={() => onPage(page - 1)}
          disabled={page === 0}
          title="Previous page"
        >
          ‹
        </button>
        <span className="text-[11px] text-muted-foreground tabular-nums px-1">
          {page + 1}/{totalPages}
        </span>
        <button
          className="w-7 h-6 flex items-center justify-center rounded border border-border
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors
                     disabled:opacity-30 disabled:cursor-not-allowed text-xs"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages - 1}
          title="Next page"
        >
          ›
        </button>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function CommitListView({ isActive = true }: { isActive?: boolean }) {
  const dispatch = useAppDispatch();
  const graphData = useAppSelector((s) => s.graphData);
  const filter = useAppSelector((s) => s.filter);
  const selectedNode = useAppSelector((s) => s.selectedNode);
  const selectedNodes = useAppSelector((s) => s.selectedNodes);
  const branches = useAppSelector((s) => s.branches);
  const repoInfo = useAppSelector((s) => s.repoInfo);
  const selectedShaSet = new Set(selectedNodes.map(n => n.commit.sha));

  const [page, setPage]         = useState(0);
  const [pageSize, setPageSize] = useState<number>(25);
  const listRef                 = useRef<HTMLDivElement>(null);

  const filteredCommits = useMemo(() => {
    if (!graphData) return [];
    // Use graphData.nodes order (topologically sorted, newest-first, row 0 = HEAD)
    // instead of allCommits which may arrive in arbitrary fetch order from the API.
    const sortedCommits = graphData.nodes.map(n => n.commit);
    return applyFilter(sortedCommits, filter, graphData.commitMap, branches);
  }, [graphData, filter, branches]);

  const highlightedShas = useMemo<Set<string> | null>(() => {
    const hasFilter = filter.search || filter.branch || filter.author || filter.dateFrom || filter.dateTo;
    if (!hasFilter) return null;
    return new Set(filteredCommits.map(c => c.sha));
  }, [filteredCommits, filter]);

  // Reset to page 0 when filter changes
  useEffect(() => { setPage(0); }, [filteredCommits.length, pageSize]);

  // Scroll list to top when page changes (only if not triggered by selectedNode navigation)
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page]);

  // Navigate to the page containing selected commit, then scroll to it
  useEffect(() => {
    if (!selectedNode || !graphData) return;
    const sha = selectedNode.commit.sha;
    const allNodes = filteredCommits
      .map(c => graphData.commitMap.get(c.sha))
      .filter((n): n is NonNullable<typeof n> => !!n);

    const idx = allNodes.findIndex(n => n.commit.sha === sha);
    if (idx === -1) return; // commit not in current filter

    const targetPage = Math.floor(idx / pageSize);
    setPage(targetPage);

    // After page update, scroll to the row
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = listRef.current?.querySelector(`[data-sha="${sha}"]`);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.commit.sha]);

  // When this list tab becomes visible with a pre-selected node (e.g. user clicked a
  // graph node then switched to the Commits tab), navigate to the right page and
  // smooth-scroll to the selected commit row.
  const prevIsActiveRef = useRef(isActive);
  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (!isActive || wasActive || !selectedNode || !graphData) return;

    const sha = selectedNode.commit.sha;
    const allNodes = filteredCommits
      .map(c => graphData.commitMap.get(c.sha))
      .filter((n): n is NonNullable<typeof n> => !!n);

    const idx = allNodes.findIndex(n => n.commit.sha === sha);
    if (idx === -1) return;

    const targetPage = Math.floor(idx / pageSize);
    setPage(targetPage);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = listRef.current?.querySelector(`[data-sha="${sha}"]`);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const handleSelect = useCallback((node: GraphNode, shiftHeld: boolean) => {
    if (shiftHeld) {
      dispatch({ type: 'TOGGLE_MULTI_SELECT', node });
    } else {
      const isSame = selectedNodes.length === 1 && selectedNode?.commit.sha === node.commit.sha;
      dispatch({ type: 'SELECT_NODE', node: isSame ? null : node });
    }
    // Intentionally NOT dispatching SCROLL_TO_SHA — clicking a commit in the
    // list must NOT re-pan the canvas. The canvas → list direction (clicking a
    // graph node scrolls the list to that row) is preserved via the
    // selectedNode useEffect above.
  }, [dispatch, selectedNode, selectedNodes]);

  if (!graphData) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground py-16">
        <span className="text-3xl">⑂</span>
        <span className="text-sm">No repository loaded</span>
      </div>
    );
  }

  const nodes = filteredCommits
    .map(c => graphData.commitMap.get(c.sha))
    .filter((n): n is GraphNode => !!n);

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground py-16">
        <span className="text-3xl">🔍</span>
        <span className="text-sm">No commits match your filter</span>
      </div>
    );
  }

  const repoUrl = repoInfo?.url ?? null;

  // ── Multi-select mode: show only the selected commits with all panels open ──
  const isMultiSelectMode = selectedNodes.length > 1;

  if (isMultiSelectMode) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Multi-select header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border
                        bg-muted/30 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground
                        flex-shrink-0">
          <div className="w-0.5 flex-shrink-0" />
          <span className="flex-1">
            {selectedNodes.length} commits selected
          </span>
          <button
            className="font-normal normal-case tracking-normal text-muted-foreground hover:text-foreground
                       transition-colors"
            onClick={() => dispatch({ type: 'SELECT_NODE', node: null })}
          >
            clear selection
          </button>
        </div>

        {/* Selected commits only — all panels open */}
        <div ref={listRef} className="flex-1 overflow-y-auto" role="grid">
          {selectedNodes.map(node => (
            <div key={node.commit.sha}>
              <CommitRow
                node={node}
                isSelected={true}
                isDimmed={false}
                onSelect={handleSelect}
                branchMap={graphData.branchMap}
                tagMap={graphData.tagMap}
                repoUrl={repoUrl}
              />
              <DetailPanel mode="inline" node={node} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Normal mode: paginated list ─────────────────────────────────────────────
  const totalPages = Math.ceil(nodes.length / pageSize);
  const safePageSize = Math.min(pageSize, 50);
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const pageNodes = nodes.slice(safePage * safePageSize, (safePage + 1) * safePageSize);

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
        {/* Shift hint */}
        <span className="hidden lg:flex items-center gap-1 ml-2 flex-shrink-0 font-normal normal-case tracking-normal opacity-50">
          <kbd className="px-1 py-0.5 rounded border border-border bg-card text-[9px] font-mono">⇧</kbd>
          <span className="text-[9px]">multi-select</span>
        </span>
      </div>

      {/* Scrollable list */}
      <div ref={listRef} className="flex-1 overflow-y-auto" role="grid">
        {pageNodes.map(node => {
          const isSelected = selectedShaSet.has(node.commit.sha);
          return (
            <div key={node.commit.sha}>
              <CommitRow
                node={node}
                isSelected={isSelected}
                isDimmed={highlightedShas !== null && !highlightedShas.has(node.commit.sha)}
                onSelect={handleSelect}
                branchMap={graphData.branchMap}
                tagMap={graphData.tagMap}
                repoUrl={repoUrl}
              />
              {/* Inline detail panel — animated slide-in below the selected commit row */}
              <AnimatePresence initial={false}>
                {isSelected && (
                  <motion.div
                    key="inline-panel"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden"
                  >
                    <DetailPanel mode="inline" node={node} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      <Pagination
        page={safePage}
        pageSize={safePageSize}
        total={nodes.length}
        onPage={setPage}
        onPageSize={setPageSize}
      />
    </div>
  );
}
