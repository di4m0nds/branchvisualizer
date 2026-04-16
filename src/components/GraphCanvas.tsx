import { useEffect, useRef, useCallback, useState, useMemo, type RefObject } from 'react';
import type { GraphData, GraphNode, ViewportState } from '../types';
import { useAppContext } from '../store/AppContext';
import { useCanvas } from '../hooks/useCanvas';
import { renderGraph, renderMinimap, graphHeight } from '../graph/renderer';
import { nodeCanvasX, nodeCanvasY } from '../graph/renderer';
import type { RenderOptions, DragState } from '../graph/renderer';
import CommitTimeline from './CommitTimeline';
import { ROW_HEIGHT, COL_WIDTH, GRAPH_PADDING_TOP, GRAPH_PADDING_LEFT } from '../graph/colors';

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

  // ── Elastic drag state — updated imperatively to avoid React re-renders ──
  // The ref holds the live physics state; the render loop reads from it.
  const dragStateRef = useRef<(DragState & { vx: number; vy: number; returning: boolean }) | null>(null);
  const dragLoopRef  = useRef<number>(0);

  // ── Mouse position in graph-space (for magnetic attraction) ───────────────
  const mousePosRef = useRef<{ gx: number; gy: number } | null>(null);

  // ── Stable callbacks ───────────────────────────────────────────────────
  const handleViewportChange = useCallback((v: Partial<ViewportState>) => {
    dispatch({ type: 'SET_VIEWPORT', viewport: v });
  }, [dispatch]);

  const handleHover = useCallback((node: GraphNode | null) => {
    dispatch({ type: 'HOVER_NODE', node });
  }, [dispatch]);

  const handleSelect = useCallback((node: GraphNode | null) => {
    dispatch({ type: 'SELECT_NODE', node });
  }, [dispatch]);

  // ── Render helper — always reads fresh refs ────────────────────────────
  const renderNow = useCallback((animTime?: number) => {
    const ctx = ctxRef.current;
    const opts = renderOptsRef.current;
    if (!ctx || !opts) return;
    if (graphData) {
      renderGraph(ctx, graphData, {
        ...opts,
        animTime,
        dragState: dragStateRef.current,
        mouseGx: mousePosRef.current?.gx,
        mouseGy: mousePosRef.current?.gy,
      });
    } else {
      const theme = opts.theme ?? 'dark';
      ctx.fillStyle = theme === 'light' ? '#f6f7fb' : '#080b11';
      ctx.fillRect(0, 0, opts.width, opts.height);
    }
  }, [graphData]);

  // ── Drag loop — runs only while a drag / spring-back is active ──────────
  const startDragLoop = useCallback(() => {
    cancelAnimationFrame(dragLoopRef.current);

    const STIFFNESS = 0.15;
    const DAMPING   = 0.78; // higher = bouncier spring-back

    function loop() {
      const ds = dragStateRef.current;

      if (!ds) {
        // Drag fully settled — paint once without drag state then stop
        renderNow();
        return;
      }

      if (ds.returning) {
        // Damped spring toward origin
        ds.vx += (-ds.dx) * STIFFNESS;
        ds.vy += (-ds.dy) * STIFFNESS;
        ds.vx *= DAMPING;
        ds.vy *= DAMPING;
        ds.dx += ds.vx;
        ds.dy += ds.vy;

        if (
          Math.abs(ds.dx) < 0.4 && Math.abs(ds.dy) < 0.4 &&
          Math.abs(ds.vx) < 0.4 && Math.abs(ds.vy) < 0.4
        ) {
          dragStateRef.current = null;
          renderNow();
          return;
        }
      }

      renderNow();
      dragLoopRef.current = requestAnimationFrame(loop);
    }

    dragLoopRef.current = requestAnimationFrame(loop);
  }, [renderNow]);

  // Maximum graph-space displacement — prevents pulling a node so far it
  // disconnects visually from the rest of the graph
  const MAX_DRAG_DIST = 170; // graph-space pixels

  const handleNodeDrag = useCallback((sha: string, dx: number, dy: number) => {
    // Clamp to max pull radius
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_DRAG_DIST) {
      const ratio = MAX_DRAG_DIST / dist;
      dx *= ratio;
      dy *= ratio;
    }

    if (!dragStateRef.current) {
      dragStateRef.current = { sha, dx, dy, vx: 0, vy: 0, returning: false };
      startDragLoop();
    } else {
      dragStateRef.current.sha = sha;
      dragStateRef.current.dx  = dx;
      dragStateRef.current.dy  = dy;
      dragStateRef.current.returning = false;
    }
  }, [startDragLoop]);

  const handleNodeDragEnd = useCallback((_sha: string) => {
    if (dragStateRef.current) {
      dragStateRef.current.returning = true;
    }
    // Loop is already running; it will spring-back on its own
  }, []);

  const { fitToView } = useCanvas(canvasRef as RefObject<HTMLCanvasElement>, {
    graph: graphData,
    viewport,
    onViewportChange: handleViewportChange,
    onHover: handleHover,
    onSelect: handleSelect,
    direction: graphDirection,
    onNodeDrag: handleNodeDrag,
    onNodeDragEnd: handleNodeDragEnd,
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

  // ── Canvas physical size (DPR-aware) ──────────────────────────────────
  // We apply DPR scaling once and then render immediately to prevent the
  // blank-canvas flash that previously appeared during tab resize.
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
    // Paint immediately to avoid blank frame on resize
    if (renderOptsRef.current && ctxRef.current) {
      const opts = { ...renderOptsRef.current, width: canvasSize.w, height: canvasSize.h };
      renderOptsRef.current = opts;
      if (graphData) renderGraph(ctxRef.current, graphData, opts);
    }
  // graphData intentionally not in deps — this only handles DPR / sizing
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize]);

  // ── Mouse position tracking — for magnetic attraction effect ────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseMove = (e: MouseEvent) => {
      if (!graphData) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { scale, offsetX, offsetY } = viewportRef.current;
      mousePosRef.current = {
        gx: (cx - offsetX) / scale,
        gy: (cy - offsetY) / scale,
      };
      // Trigger a render so attraction updates in real-time (only when no other loop owns the canvas)
      if (!dragStateRef.current) renderNow();
    };

    const onMouseLeave = () => {
      if (mousePosRef.current) {
        mousePosRef.current = null;
        if (!dragStateRef.current) renderNow();
      }
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  // renderNow is stable; graphData dep ensures re-attach when graph loads
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, renderNow]);

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

    // Don't schedule a frame while the drag loop owns the canvas
    if (dragStateRef.current) return;

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
      // Yield to drag loop when active — it will draw its own frame
      if (ctx && opts && graphData && !dragStateRef.current) {
        renderGraph(ctx, graphData, {
          ...opts,
          animTime: elapsed,
          dragState: null,
        });
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

    const nx = nodeCanvasX(node, graphDirection);
    const ny = nodeCanvasY(node, graphDirection);
    const targetX = canvasSize.w / 2 - nx * scale;
    const targetY = canvasSize.h / 2 - ny * scale;

    const duration = 520;
    const startTime = performance.now();

    cancelAnimationFrame(panAnimRef.current);

    function frame(now: number) {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
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

  // ── Timeline jump — smooth-pan to a row's position ───────────────────────
  const timelineJumpAnimRef = useRef<number>(0);
  const handleTimelineJump = useCallback((row: number) => {
    if (!graphData) return;
    cancelAnimationFrame(timelineJumpAnimRef.current);

    const { scale } = viewportRef.current;
    const startX = viewportRef.current.offsetX;
    const startY = viewportRef.current.offsetY;

    let targetX = startX;
    let targetY = startY;

    if (graphDirection === 'vertical') {
      const graphY = GRAPH_PADDING_TOP + row * ROW_HEIGHT;
      targetY = canvasSize.h * 0.15 - graphY * scale;
    } else {
      const graphX = GRAPH_PADDING_LEFT + row * COL_WIDTH;
      targetX = canvasSize.w * 0.15 - graphX * scale;
    }

    const duration = 480;
    const startTime = performance.now();

    function frame(now: number) {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      dispatch({
        type: 'SET_VIEWPORT',
        viewport: {
          offsetX: startX + (targetX - startX) * ease,
          offsetY: startY + (targetY - startY) * ease,
        },
      });
      if (t < 1) timelineJumpAnimRef.current = requestAnimationFrame(frame);
    }

    timelineJumpAnimRef.current = requestAnimationFrame(frame);
  }, [graphData, graphDirection, canvasSize, dispatch]);

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
        <div className="absolute top-3 right-[58px] rounded-md overflow-hidden border border-border/50
                        shadow-md opacity-60 hover:opacity-100 transition-opacity z-30">
          <canvas ref={minimapRef} className="block" width={8} height={120} />
        </div>
      )}

      {/* Interactive timeline — tracks month/year positions in the graph */}
      {graphData && graphData.rowCount > 5 && (
        <CommitTimeline
          graphData={graphData}
          viewport={viewport}
          direction={graphDirection}
          canvasW={canvasSize.w}
          canvasH={canvasSize.h}
          onJump={handleTimelineJump}
        />
      )}

      {/* Zoom controls — offset right to leave room for the timeline strip (~52px) */}
      <div className="absolute bottom-3 right-[58px] flex flex-col gap-1
                      bg-card/90 backdrop-blur-sm border border-border rounded-lg shadow-md
                      p-1 text-xs z-30">
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

      {/* Keyboard hint — pushed up in horizontal mode to clear the timeline strip */}
      {graphData && (
        <div className={`absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5
                        px-3 py-1.5 rounded-full border border-border bg-background/80 backdrop-blur-sm
                        text-xs text-muted-foreground font-mono pointer-events-none select-none
                        hidden sm:flex
                        ${graphDirection === 'horizontal' ? 'bottom-12' : 'bottom-3'}`}>
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
