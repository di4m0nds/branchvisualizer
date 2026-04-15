import { useEffect, useRef, useCallback, useState, useMemo, type RefObject } from 'react';
import type { GraphData, GraphNode, ViewportState } from '../types';
import { useAppContext } from '../store/AppContext';
import { useCanvas } from '../hooks/useCanvas';
import { renderGraph, renderMinimap, graphHeight, graphWidth } from '../graph/renderer';
import { nodeCanvasX, nodeCanvasY } from '../graph/renderer';
import type { RenderOptions } from '../graph/renderer';

// ─── Branch reachability (BFS) ────────────────────────────────────────────

function reachableFromTip(tipSha: string, commitMap: GraphData['commitMap']): Set<string> {
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

// ─── GraphCanvas component ────────────────────────────────────────────────

export default function GraphCanvas() {
  const { state, dispatch } = useAppContext();
  const { graphData, viewport, selectedNode, hoveredNode, filter, branches, allCommits, graphDirection } = state;

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const minimapRef   = useRef<HTMLCanvasElement>(null);
  const rafRef       = useRef<number>(0);
  const animRafRef   = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderOptsRef = useRef<RenderOptions | null>(null);

  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  // ── Stable callbacks ───────────────────────────────────────────────────
  const handleViewportChange = useCallback((v: Partial<ViewportState>) => {
    dispatch({ type: 'SET_VIEWPORT', viewport: v });
  }, [dispatch]);

  const handleHover = useCallback((node: GraphNode | null) => {
    dispatch({ type: 'HOVER_NODE', node });
  }, [dispatch]);

  const handleSelect = useCallback((node: GraphNode | null) => {
    dispatch({ type: 'SELECT_NODE', node });
    if (node) {
      dispatch({ type: 'SET_ACTIVE_TAB', tab: 'list' });
    }
  }, [dispatch]);

  const { fitToView } = useCanvas(canvasRef as RefObject<HTMLCanvasElement>, {
    graph: graphData,
    viewport,
    onViewportChange: handleViewportChange,
    onHover: handleHover,
    onSelect: handleSelect,
    direction: graphDirection,
  });

  // ── Filter computation ─────────────────────────────────────────────────
  const highlightedShas = useMemo<Set<string> | null>(() => {
    if (!graphData) return null;
    const hasFilter = filter.search || filter.branch || filter.author || filter.dateFrom || filter.dateTo;
    if (!hasFilter) return null;

    const search   = filter.search.toLowerCase();
    const dateFrom = filter.dateFrom ? new Date(filter.dateFrom).getTime() : 0;
    const dateTo   = filter.dateTo   ? new Date(filter.dateTo + 'T23:59:59').getTime() : Infinity;

    let branchReachable: Set<string> | null = null;
    if (filter.branch) {
      const tip = branches.find(b => b.name === filter.branch)?.sha;
      branchReachable = tip ? reachableFromTip(tip, graphData.commitMap) : new Set();
    }

    const matching = new Set<string>();
    for (const commit of allCommits) {
      if (branchReachable && !branchReachable.has(commit.sha)) continue;
      if (search) {
        const a = commit.author;
        const hit =
          commit.sha.startsWith(search)                          ||
          commit.subject.toLowerCase().includes(search)          ||
          a.name.toLowerCase().includes(search)                  ||
          (a.login?.toLowerCase().includes(search) ?? false)     ||
          a.email.toLowerCase().includes(search);
        if (!hit) continue;
      }
      if (filter.author) {
        const a = commit.author;
        if (a.name !== filter.author && a.login !== filter.author && a.email !== filter.author) continue;
      }
      if (filter.dateFrom || filter.dateTo) {
        const t = new Date(commit.author.date).getTime();
        if (t < dateFrom || t > dateTo) continue;
      }
      matching.add(commit.sha);
    }

    return matching.size > 0 ? matching : new Set<string>();
  }, [graphData, filter, branches, allCommits]);

  // ── Canvas resize observer ─────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(entries => {
      const e = entries[0];
      if (!e) return;
      const w = Math.floor(e.contentRect.width);
      const h = Math.floor(e.contentRect.height);
      setCanvasSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Canvas physical size (DPR-aware) ───────────────────────────────────
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    canvas.style.width  = `${canvasSize.w}px`;
    canvas.style.height = `${canvasSize.h}px`;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctxRef.current = ctx;
    }
  }, [canvasSize]);

  // ── Main render loop ───────────────────────────────────────────────────
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    const theme = state.theme ?? 'dark';
    const opts: RenderOptions = {
      width:          canvasSize.w,
      height:         canvasSize.h,
      scale:          viewport.scale,
      offsetX:        viewport.offsetX,
      offsetY:        viewport.offsetY,
      selectedSha:    selectedNode?.commit.sha ?? null,
      hoveredSha:     hoveredNode?.commit.sha  ?? null,
      highlightedShas,
      showMessages:   viewport.scale > 0.6,
      theme,
      direction:      graphDirection,
    };

    // Keep renderOptsRef current so animation loop always has fresh opts
    renderOptsRef.current = opts;

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!graphData) {
        ctx.fillStyle = theme === 'light' ? '#f6f7fb' : '#080b11';
        ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);
      } else {
        renderGraph(ctx, graphData, opts);
      }
    });

    return () => cancelAnimationFrame(rafRef.current);
  }, [graphData, viewport, selectedNode, hoveredNode, highlightedShas, canvasSize, state.theme, graphDirection]);

  // ── Animation loop (orbiting arc + dashed edges when a node is selected) ─
  useEffect(() => {
    cancelAnimationFrame(animRafRef.current);
    if (!selectedNode || !graphData) return;

    let startTs = 0;

    function animLoop(ts: number) {
      if (!startTs) startTs = ts;
      const elapsed = ts - startTs;
      const ctx = ctxRef.current;
      const opts = renderOptsRef.current;
      if (ctx && opts && graphData) {
        renderGraph(ctx, graphData, { ...opts, animTime: elapsed });
      }
      animRafRef.current = requestAnimationFrame(animLoop);
    }

    animRafRef.current = requestAnimationFrame(animLoop);
    return () => cancelAnimationFrame(animRafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.commit.sha, graphData]);

  // ── Minimap (vertical mode only) ──────────────────────────────────────
  useEffect(() => {
    const canvas = minimapRef.current;
    if (!canvas || !graphData || graphDirection === 'horizontal') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const totalH = graphHeight(graphData.rowCount, 'vertical', graphData.laneCount);
    renderMinimap(ctx, graphData, viewport.offsetY, canvasSize.h, totalH, 120, 8);
  }, [graphData, viewport.offsetY, canvasSize.h, graphDirection]);

  // ── Fit on initial load (once per repo) ───────────────────────────────
  const fittedRepoRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.loadState.phase === 'done' && graphData && state.repoInfo) {
      const key = `${state.repoInfo.owner}/${state.repoInfo.repo}`;
      if (fittedRepoRef.current !== key) {
        fittedRepoRef.current = key;
        fitToView(canvasSize.w, canvasSize.h);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loadState.phase, state.repoInfo]);

  // ── Re-fit when direction changes ─────────────────────────────────────
  const prevDirectionRef = useRef(graphDirection);
  useEffect(() => {
    if (prevDirectionRef.current !== graphDirection && graphData) {
      prevDirectionRef.current = graphDirection;
      fitToView(canvasSize.w, canvasSize.h);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphDirection]);

  // ── Smooth pan to SHA ─────────────────────────────────────────────────
  // Use a ref to always have the latest viewport without stale closure issues
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const panAnimRef = useRef<number>(0);
  useEffect(() => {
    if (!state.panToSha || !graphData) return;
    const node = graphData.commitMap.get(state.panToSha);

    dispatch({ type: 'SCROLL_TO_SHA', sha: null });

    if (!node) return;

    const startX = viewportRef.current.offsetX;
    const startY = viewportRef.current.offsetY;
    const { scale } = viewportRef.current;

    // Target: center the node in the canvas
    const nx = nodeCanvasX(node, graphDirection);
    const ny = nodeCanvasY(node, graphDirection);
    const targetX = canvasSize.w / 2 - nx * scale;
    const targetY = canvasSize.h / 2 - ny * scale;

    const duration = 520;
    const startTime = performance.now();

    cancelAnimationFrame(panAnimRef.current);

    function frame(now: number) {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      dispatch({
        type: 'SET_VIEWPORT',
        viewport: {
          offsetX: startX + (targetX - startX) * ease,
          offsetY: startY + (targetY - startY) * ease,
        },
      });
      if (t < 1) {
        panAnimRef.current = requestAnimationFrame(frame);
      }
    }

    panAnimRef.current = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(panAnimRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.panToSha]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const { scale, offsetX, offsetY } = viewport;
      switch (e.key) {
        case 'Escape':
          dispatch({ type: 'SELECT_NODE', node: null });
          break;
        case 'f': case 'F':
          if (!e.metaKey && !e.ctrlKey) fitToView(canvasSize.w, canvasSize.h);
          break;
        case '+': case '=':
          dispatch({ type: 'SET_VIEWPORT', viewport: { scale: Math.min(3, scale * 1.2), offsetX, offsetY } });
          break;
        case '-':
          dispatch({ type: 'SET_VIEWPORT', viewport: { scale: Math.max(0.15, scale * 0.8), offsetX, offsetY } });
          break;
        case '0':
          dispatch({ type: 'SET_VIEWPORT', viewport: { scale: 1, offsetX: 16, offsetY: 16 } });
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewport, dispatch, canvasSize, fitToView]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Minimap — only in vertical mode, only for large graphs */}
      {graphData && graphData.rowCount > 50 && graphDirection === 'vertical' && (
        <div className="absolute top-3 right-3 rounded-md overflow-hidden border border-border/50
                        shadow-md opacity-60 hover:opacity-100 transition-opacity">
          <canvas ref={minimapRef} className="block" width={8} height={120} />
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1
                      bg-card/90 backdrop-blur-sm border border-border rounded-lg shadow-md
                      p-1 text-xs">
        <button
          className="w-7 h-7 flex items-center justify-center rounded
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors font-mono"
          title="Zoom in (+)"
          onClick={() => dispatch({ type: 'SET_VIEWPORT', viewport: { scale: Math.min(3, viewport.scale * 1.25) } })}
        >+</button>
        <span className="text-center text-[10px] text-muted-foreground tabular-nums py-0.5 leading-none">
          {Math.round(viewport.scale * 100)}%
        </span>
        <button
          className="w-7 h-7 flex items-center justify-center rounded
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors font-mono"
          title="Zoom out (−)"
          onClick={() => dispatch({ type: 'SET_VIEWPORT', viewport: { scale: Math.max(0.15, viewport.scale * 0.8) } })}
        >−</button>
        <div className="h-px bg-border mx-1" />
        <button
          className="w-7 h-7 flex items-center justify-center rounded
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-base"
          title="Fit to view (F)"
          onClick={() => fitToView(canvasSize.w, canvasSize.h)}
        >⊞</button>
      </div>

      {/* Keyboard hint */}
      {graphData && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5
                        px-3 py-1.5 rounded-full border border-border bg-background/80 backdrop-blur-sm
                        text-xs text-muted-foreground font-mono pointer-events-none select-none
                        hidden sm:flex">
          <kbd className="px-1 py-0.5 rounded border border-border bg-card text-[10px]">F</kbd>
          <span>fit</span>
          <span className="opacity-40">·</span>
          <kbd className="px-1 py-0.5 rounded border border-border bg-card text-[10px]">+</kbd>
          <kbd className="px-1 py-0.5 rounded border border-border bg-card text-[10px]">−</kbd>
          <span>zoom</span>
          <span className="opacity-40">·</span>
          <kbd className="px-1 py-0.5 rounded border border-border bg-card text-[10px]">Esc</kbd>
          <span>deselect</span>
        </div>
      )}

      {/* Empty state */}
      {!graphData && state.loadState.phase === 'idle' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-8">
          <svg width="52" height="52" viewBox="0 0 56 56" fill="none" className="opacity-20">
            <circle cx="28" cy="12" r="6" stroke="currentColor" strokeWidth="2"/>
            <circle cx="14" cy="36" r="6" stroke="currentColor" strokeWidth="2"/>
            <circle cx="42" cy="36" r="6" stroke="currentColor" strokeWidth="2"/>
            <line x1="28" y1="18" x2="14" y2="30" stroke="currentColor" strokeWidth="2"/>
            <line x1="28" y1="18" x2="42" y2="30" stroke="currentColor" strokeWidth="2"/>
          </svg>
          <p className="text-sm text-muted-foreground">
            Enter a GitHub repository URL to visualize its commit graph
          </p>
        </div>
      )}
    </div>
  );
}
