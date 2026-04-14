import { useEffect, useRef, useCallback, useState, useMemo, type RefObject } from 'react';
import type { GraphData, GraphNode, ViewportState } from '../types';
import { useAppContext } from '../store/AppContext';
import { useCanvas } from '../hooks/useCanvas';
import { renderGraph, renderMinimap, graphHeight } from '../graph/renderer';
import type { RenderOptions } from '../graph/renderer';

// ─── Branch reachability (BFS) — O(n), run only when branch filter changes ──

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

// ─── GraphCanvas component ───────────────────────────────────────────────────

export default function GraphCanvas() {
  const { state, dispatch } = useAppContext();
  const { graphData, viewport, selectedNode, hoveredNode, filter, branches, allCommits } = state;

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const minimapRef   = useRef<HTMLCanvasElement>(null);
  const rafRef       = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  // ── Stable callbacks ───────────────────────────────────────────────────────
  const handleViewportChange = useCallback((v: Partial<ViewportState>) => {
    dispatch({ type: 'SET_VIEWPORT', viewport: v });
  }, [dispatch]);

  const handleHover = useCallback((node: GraphNode | null) => {
    dispatch({ type: 'HOVER_NODE', node });
  }, [dispatch]);

  const handleSelect = useCallback((node: GraphNode | null) => {
    dispatch({ type: 'SELECT_NODE', node });
  }, [dispatch]);

  const { fitToView } = useCanvas(canvasRef as RefObject<HTMLCanvasElement>, {
    graph: graphData,
    viewport,
    onViewportChange: handleViewportChange,
    onHover: handleHover,
    onSelect: handleSelect,
  });

  // ── Memoized filter computation ────────────────────────────────────────────
  // Only recomputes when filter fields, graph, or commits change —
  // NOT on viewport moves, hover, or selection (which are the hot path).
  const highlightedShas = useMemo<Set<string> | null>(() => {
    if (!graphData) return null;
    const hasFilter = filter.search || filter.branch || filter.author || filter.dateFrom || filter.dateTo;
    if (!hasFilter) return null;

    const search   = filter.search.toLowerCase();
    const dateFrom = filter.dateFrom ? new Date(filter.dateFrom).getTime() : 0;
    const dateTo   = filter.dateTo   ? new Date(filter.dateTo + 'T23:59:59').getTime() : Infinity;

    // Branch reachability (BFS) — computed once per branch selection
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

  // ── Canvas resize observer ─────────────────────────────────────────────────
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

  // ── Canvas physical size (DPR-aware) — only when canvas dimensions change ──
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

  // ── Main render loop ───────────────────────────────────────────────────────
  // Runs on every render-relevant state change, throttled to one rAF per cycle.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

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
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!graphData) {
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);
      } else {
        renderGraph(ctx, graphData, opts);
      }
    });

    return () => cancelAnimationFrame(rafRef.current);
  // Note: `state` is intentionally NOT a dep — we list individual stable values
  // so that token/loadState changes don't trigger unnecessary redraws.
  }, [graphData, viewport, selectedNode, hoveredNode, highlightedShas, canvasSize]);

  // ── Minimap ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = minimapRef.current;
    if (!canvas || !graphData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const totalH = graphHeight(graphData.rowCount);
    renderMinimap(ctx, graphData, viewport.offsetY, canvasSize.h, totalH, 120, 8);
  }, [graphData, viewport.offsetY, canvasSize.h]);

  // ── Fit on initial load ────────────────────────────────────────────────────
  useEffect(() => {
    if (state.loadState.phase === 'done' && graphData) {
      fitToView(canvasSize.w, canvasSize.h);
    }
    // Intentionally only fires when load phase transitions to done
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loadState.phase]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="graph-canvas-container">
      <canvas ref={canvasRef} className="graph-canvas" />

      {/* Minimap — only shown when graph is large enough to need navigation */}
      {graphData && graphData.rowCount > 50 && (
        <div className="minimap-container">
          <canvas ref={minimapRef} className="minimap-canvas" width={8} height={120} />
        </div>
      )}

      {/* Zoom controls */}
      <div className="zoom-controls">
        <button
          className="zoom-btn"
          title="Zoom in (+)"
          onClick={() => dispatch({ type: 'SET_VIEWPORT', viewport: { scale: Math.min(3, viewport.scale * 1.25) } })}
        >+</button>
        <span className="zoom-level">{Math.round(viewport.scale * 100)}%</span>
        <button
          className="zoom-btn"
          title="Zoom out (−)"
          onClick={() => dispatch({ type: 'SET_VIEWPORT', viewport: { scale: Math.max(0.15, viewport.scale * 0.8) } })}
        >−</button>
        <button
          className="zoom-btn zoom-fit"
          title="Fit to view (F)"
          onClick={() => fitToView(canvasSize.w, canvasSize.h)}
        >⊞</button>
      </div>

      {/* Empty state */}
      {!graphData && state.loadState.phase === 'idle' && (
        <div className="canvas-empty-state">
          <div className="canvas-empty-icon">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="12" r="6" stroke="#30363d" strokeWidth="2"/>
              <circle cx="14" cy="36" r="6" stroke="#30363d" strokeWidth="2"/>
              <circle cx="42" cy="36" r="6" stroke="#30363d" strokeWidth="2"/>
              <line x1="28" y1="18" x2="14" y2="30" stroke="#30363d" strokeWidth="2"/>
              <line x1="28" y1="18" x2="42" y2="30" stroke="#30363d" strokeWidth="2"/>
            </svg>
          </div>
          <p className="canvas-empty-text">
            Paste a GitHub repository URL above to visualize its commit graph
          </p>
          <p className="canvas-empty-hint">
            Try: <code>torvalds/linux</code> · <code>facebook/react</code> · <code>microsoft/vscode</code>
          </p>
        </div>
      )}
    </div>
  );
}
