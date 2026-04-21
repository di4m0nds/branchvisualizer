import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppContext } from '@/store/AppContext';
import { fetchCompareCommits, setToken, type CompareResult, type CommitFile } from '@/lib/github';
import { cn } from '@/lib/utils';

// ─── File status badge ─────────────────────────────────────────────────────

function FileStatusBadge({ status }: { status: CommitFile['status'] }) {
  const cfg: Record<string, { cls: string; label: string }> = {
    added:     { cls: 'bg-green-500/15 text-green-400 border-green-500/30', label: 'A' },
    removed:   { cls: 'bg-red-500/15 text-red-400 border-red-500/30',       label: 'D' },
    modified:  { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'M' },
    renamed:   { cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30',    label: 'R' },
    copied:    { cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30',       label: 'C' },
    changed:   { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'M' },
    unchanged: { cls: 'bg-muted/40 text-muted-foreground border-border',    label: '=' },
  };
  const { cls, label } = cfg[status] ?? cfg.modified;
  return (
    <span className={cn(
      'flex-shrink-0 w-4 h-4 rounded text-[9px] font-mono font-bold border flex items-center justify-center',
      cls,
    )}>
      {label}
    </span>
  );
}

// ─── Stats bar ─────────────────────────────────────────────────────────────

function StatsBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const addPct = (additions / total) * 100;
  return (
    <div className="h-1 rounded-full overflow-hidden bg-muted flex">
      <div className="h-full bg-green-400 rounded-full" style={{ width: `${addPct}%` }} />
      <div className="h-full bg-red-400 rounded-full flex-1" />
    </div>
  );
}

// ─── Main ComparePanel ─────────────────────────────────────────────────────

export default function ComparePanel() {
  const { state, dispatch } = useAppContext();
  const { selectedNodes, repoInfo, token } = state;

  // Determine base (older) vs head (newer) by commit date
  const [nodeA, nodeB] = selectedNodes.slice(0, 2);
  const dateA = nodeA ? new Date(nodeA.commit.author.date).getTime() : 0;
  const dateB = nodeB ? new Date(nodeB.commit.author.date).getTime() : 0;
  const baseNode = dateA < dateB ? nodeA : nodeB;
  const headNode = dateA < dateB ? nodeB : nodeA;

  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const baseSha = baseNode?.commit.sha ?? '';
  const headSha = headNode?.commit.sha ?? '';

  // Fetch comparison
  useEffect(() => {
    if (!repoInfo || !baseSha || !headSha) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    setToken(token);

    fetchCompareCommits(repoInfo.owner, repoInfo.repo, baseSha, headSha)
      .then(r => { if (!cancelled) setResult(r); })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to compare commits'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [repoInfo, baseSha, headSha, token]);

  // Draggable panel
  const PANEL_W = 340;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 540;

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const sw = typeof window !== 'undefined' ? window.innerWidth : 800;
    const sh = typeof window !== 'undefined' ? window.innerHeight : 600;
    if (sw < 540) return { x: Math.max(8, (sw - PANEL_W) / 2), y: Math.max(16, Math.round(sh * 0.15)) };
    return { x: Math.max(16, sw - PANEL_W - 16), y: 16 };
  });

  const isDragging = useRef(false);
  const dragOrigin = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    e.preventDefault();
    isDragging.current = true;
    dragOrigin.current = { mouseX: e.clientX, mouseY: e.clientY, panelX: pos.x, panelY: pos.y };

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      setPos({
        x: dragOrigin.current.panelX + (ev.clientX - dragOrigin.current.mouseX),
        y: dragOrigin.current.panelY + (ev.clientY - dragOrigin.current.mouseY),
      });
    };
    const onMouseUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [pos]);

  function handleClose() {
    dispatch({ type: 'SELECT_NODE', node: null });
  }

  const panelWidth = isMobile ? Math.min(PANEL_W, window.innerWidth - 16) : PANEL_W;
  const panelMaxH = isMobile ? `${window.innerHeight - 48}px` : 'calc(100vh - 32px)';

  const visibleFiles = expanded ? (result?.files ?? []) : (result?.files ?? []).slice(0, 8);
  const hiddenCount = (result?.files.length ?? 0) - 8;

  const panel = (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        width: panelWidth,
        maxHeight: panelMaxH,
      }}
      className="flex flex-col rounded-xl border border-border bg-card/95 backdrop-blur-sm shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0
                   cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onHeaderMouseDown}
      >
        {/* Drag handle dots */}
        <div className="flex-shrink-0 flex flex-col gap-[3px] pr-1 opacity-30">
          <div className="w-3 h-px bg-current rounded-full" />
          <div className="w-3 h-px bg-current rounded-full" />
          <div className="w-3 h-px bg-current rounded-full" />
        </div>

        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {/* Base SHA */}
          <code className="text-[11px] font-mono font-semibold" style={{ color: baseNode?.color }}>
            {baseNode?.commit.shortSha}
          </code>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor"
            strokeWidth="1.5" className="text-muted-foreground flex-shrink-0">
            <path d="M2 6h8M7 3l3 3-3 3" />
          </svg>
          {/* Head SHA */}
          <code className="text-[11px] font-mono font-semibold" style={{ color: headNode?.color }}>
            {headNode?.commit.shortSha}
          </code>
          <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0
                           bg-violet-500/10 border border-violet-500/25 text-violet-400">
            compare
          </span>
        </div>

        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => {
            dispatch({ type: 'REQUEST_AI_CHAT', shas: selectedNodes.slice(0,2).map(n => n.commit.sha), mode: 'compare' });
            dispatch({ type: 'SET_ACTIVE_TAB', tab: 'assistant' });
          }}
          title="Ask AI to compare these commits"
          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 13H8.061l-2.574 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25Z"/></svg>
        </button>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={handleClose}
          title="Close"
          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading */}
        {loading && (
          <div className="flex flex-col gap-1.5 p-4 animate-pulse">
            <div className="h-3 w-3/4 rounded bg-muted/50" />
            <div className="h-2 w-1/2 rounded bg-muted/40" />
            <div className="h-1 w-full rounded bg-muted/30 mt-2" />
            {[70, 85, 60].map((w, i) => (
              <div key={i} className="h-2.5 rounded bg-muted/40" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="p-4 flex flex-col gap-1.5">
            <span className="text-xs text-red-400">{error}</span>
          </div>
        )}

        {/* Result */}
        {!loading && result && (
          <div className="flex flex-col divide-y divide-border">
            {/* Status summary */}
            <div className="px-4 py-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-medium border',
                  result.status === 'identical'
                    ? 'bg-muted/40 text-muted-foreground border-border'
                    : result.status === 'diverged'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                      : 'bg-blue-500/10 text-blue-400 border-blue-500/25',
                )}>
                  {result.status}
                </span>
                {result.aheadBy > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    <span className="text-green-400 font-mono">+{result.aheadBy}</span> ahead
                  </span>
                )}
                {result.behindBy > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    <span className="text-red-400 font-mono">-{result.behindBy}</span> behind
                  </span>
                )}
                {result.totalCommits > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {result.totalCommits} commit{result.totalCommits !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Aggregate stats */}
              {(result.stats.additions > 0 || result.stats.deletions > 0) && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-green-400 font-mono font-semibold text-sm">
                      +{result.stats.additions.toLocaleString()}
                    </span>
                    <span className="text-red-400 font-mono font-semibold text-sm">
                      −{result.stats.deletions.toLocaleString()}
                    </span>
                    <span className="text-muted-foreground text-xs ml-auto">
                      {result.stats.changedFiles} file{result.stats.changedFiles !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <StatsBar additions={result.stats.additions} deletions={result.stats.deletions} />
                </div>
              )}
            </div>

            {/* Files list */}
            {result.files.length > 0 && (
              <div className="px-4 py-3 flex flex-col gap-0.5">
                <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                  Changed files ({result.files.length})
                </span>
                {visibleFiles.map(f => {
                  const displayName = f.status === 'renamed' && f.previousFilename
                    ? `${f.previousFilename} → ${f.filename.split('/').pop()}`
                    : f.filename;
                  const fileUrl = repoInfo ? `${repoInfo.url}/blob/${headSha}/${f.filename}` : null;

                  return (
                    <div key={f.filename} className="flex items-center gap-1.5 min-w-0">
                      <FileStatusBadge status={f.status} />
                      {fileUrl ? (
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 min-w-0 text-[11px] font-mono text-muted-foreground
                                     truncate hover:text-foreground transition-colors"
                          title={f.filename}
                        >
                          {displayName}
                        </a>
                      ) : (
                        <span className="flex-1 min-w-0 text-[11px] font-mono text-muted-foreground truncate" title={f.filename}>
                          {displayName}
                        </span>
                      )}
                      {(f.additions > 0 || f.deletions > 0) && (
                        <span className="flex-shrink-0 text-[10px] font-mono tabular-nums flex items-center gap-0.5">
                          {f.additions > 0 && <span className="text-green-400">+{f.additions}</span>}
                          {f.deletions > 0 && <span className="text-red-400">-{f.deletions}</span>}
                        </span>
                      )}
                    </div>
                  );
                })}
                {!expanded && hiddenCount > 0 && (
                  <button
                    onClick={() => setExpanded(true)}
                    className="self-start text-[10px] text-muted-foreground hover:text-foreground
                               transition-colors mt-0.5 flex items-center gap-0.5"
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M2 3.5l3 3 3-3" />
                    </svg>
                    {hiddenCount} more file{hiddenCount !== 1 ? 's' : ''}
                  </button>
                )}
              </div>
            )}

            {/* GitHub compare link */}
            {repoInfo && (
              <div className="px-4 py-3">
                <a
                  href={`${repoInfo.url}/compare/${baseSha}...${headSha}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground
                             hover:text-foreground transition-colors group"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                  </svg>
                  View diff on GitHub
                  <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                    className="opacity-50 group-hover:opacity-100 transition-opacity">
                    <path d="M2 10L10 2M10 2H5M10 2v5" />
                  </svg>
                </a>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!loading && !result && !error && (
          <div className="p-4 text-xs text-muted-foreground/50">No data</div>
        )}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

// ─── Locked state panel ────────────────────────────────────────────────────

export function ComparePanelLocked() {
  const { dispatch } = useAppContext();
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const isDragging = useRef(false);
  const dragOrigin = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    isDragging.current = true;
    dragOrigin.current = { mouseX: e.clientX, mouseY: e.clientY, panelX: pos.x, panelY: pos.y };
    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      setPos({ x: dragOrigin.current.panelX + (ev.clientX - dragOrigin.current.mouseX), y: dragOrigin.current.panelY + (ev.clientY - dragOrigin.current.mouseY) });
    };
    const onMouseUp = () => { isDragging.current = false; window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [pos]);

  const panel = (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9999, width: 280 }}
      className="flex flex-col rounded-xl border border-border bg-card/95 backdrop-blur-sm shadow-2xl overflow-hidden"
    >
      <div
        className="flex items-center gap-2 px-4 py-3 border-b border-border cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onHeaderMouseDown}
      >
        <div className="flex-shrink-0 flex flex-col gap-[3px] pr-1 opacity-30">
          <div className="w-3 h-px bg-current rounded-full" />
          <div className="w-3 h-px bg-current rounded-full" />
          <div className="w-3 h-px bg-current rounded-full" />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">Commit Comparison</span>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => dispatch({ type: 'SELECT_NODE', node: null })}
          className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
      <div className="p-4 flex flex-col items-center gap-3 text-center">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" className="text-muted-foreground/40">
          <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 3.5a2 2 0 1 1 4 0V6H6V4.5z"/>
        </svg>
        <p className="text-xs text-muted-foreground">Sign in with a GitHub token to compare commits.</p>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
