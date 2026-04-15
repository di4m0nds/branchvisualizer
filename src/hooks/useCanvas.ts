// ─── Canvas pan / zoom / hit-test interactions ────────────────────────────

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { GraphData, GraphNode, ViewportState } from '../types';
import { hitTestNode } from '../graph/layout';
import { graphHeight, graphWidth } from '../graph/renderer';

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const ZOOM_SPEED = 0.0012;

interface UseCanvasOptions {
  graph: GraphData | null;
  viewport: ViewportState;
  onViewportChange: (v: Partial<ViewportState>) => void;
  onHover: (node: GraphNode | null) => void;
  onSelect: (node: GraphNode | null) => void;
  direction?: 'vertical' | 'horizontal';
}

export function useCanvas(
  canvasRef: RefObject<HTMLCanvasElement>,
  opts: UseCanvasOptions,
) {
  const { graph, viewport, onViewportChange, onHover, onSelect } = opts;
  const dir = opts.direction ?? 'vertical';

  const vpRef = useRef(viewport);
  vpRef.current = viewport;

  const graphRef = useRef(graph);
  graphRef.current = graph;

  const dirRef = useRef(dir);
  dirRef.current = dir;

  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  // ─── Wheel (zoom) ────────────────────────────────────────────────────
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const { scale, offsetX, offsetY } = vpRef.current;

    const delta = -e.deltaY * ZOOM_SPEED;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (1 + delta)));

    const newOffsetX = mx - (mx - offsetX) * (newScale / scale);
    const newOffsetY = my - (my - offsetY) * (newScale / scale);

    onViewportChange({ scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY });
  }, [canvasRef, onViewportChange]);

  // ─── Mouse down ───────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    dragging.current = false;
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      ox: vpRef.current.offsetX,
      oy: vpRef.current.offsetY,
    };
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = 'grabbing';
  }, [canvasRef]);

  // ─── Mouse move ───────────────────────────────────────────────────────
  const onMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (e.buttons === 1) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragging.current = true;
        onViewportChange({
          offsetX: dragStart.current.ox + dx,
          offsetY: dragStart.current.oy + dy,
        });
      }
      return;
    }

    if (!graphRef.current) return;
    const { scale, offsetX, offsetY } = vpRef.current;
    const node = hitTestNode(graphRef.current, cx, cy, scale, offsetX, offsetY, 10, dirRef.current);

    canvas.style.cursor = node ? 'pointer' : 'grab';
    onHover(node);
  }, [canvasRef, onViewportChange, onHover]);

  // ─── Mouse up ─────────────────────────────────────────────────────────
  const onMouseUp = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = 'grab';

    if (dragging.current) {
      dragging.current = false;
      return;
    }
    if (e.button !== 0) return;

    if (!graphRef.current) return;
    const rect = canvas!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { scale, offsetX, offsetY } = vpRef.current;
    const node = hitTestNode(graphRef.current, cx, cy, scale, offsetX, offsetY, 12, dirRef.current);
    onSelect(node);
  }, [canvasRef, onSelect]);

  // ─── Touch ────────────────────────────────────────────────────────────
  const lastTouches = useRef<TouchList | null>(null);

  const onTouchStart = useCallback((e: TouchEvent) => {
    lastTouches.current = e.touches;
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const prev = lastTouches.current;
    const curr = e.touches;
    lastTouches.current = curr;
    if (!prev) return;

    const { scale, offsetX, offsetY } = vpRef.current;

    if (curr.length === 1 && prev.length === 1) {
      const dx = curr[0].clientX - prev[0].clientX;
      const dy = curr[0].clientY - prev[0].clientY;
      onViewportChange({ offsetX: offsetX + dx, offsetY: offsetY + dy });
    } else if (curr.length === 2 && prev.length === 2) {
      const prevDist = Math.hypot(prev[0].clientX - prev[1].clientX, prev[0].clientY - prev[1].clientY);
      const currDist = Math.hypot(curr[0].clientX - curr[1].clientX, curr[0].clientY - curr[1].clientY);
      if (prevDist === 0) return;

      const ratio = currDist / prevDist;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * ratio));

      const mx = (curr[0].clientX + curr[1].clientX) / 2;
      const my = (curr[0].clientY + curr[1].clientY) / 2;
      const newOffsetX = mx - (mx - offsetX) * (newScale / scale);
      const newOffsetY = my - (my - offsetY) * (newScale / scale);

      onViewportChange({ scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY });
    }
  }, [onViewportChange]);

  // ─── Register listeners ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
    };
  }, [canvasRef, onWheel, onMouseDown, onMouseMove, onMouseUp, onTouchStart, onTouchMove]);

  // ─── Fit to view ──────────────────────────────────────────────────────
  const fitToView = useCallback((canvasWidth: number, canvasHeight: number) => {
    if (!graphRef.current || graphRef.current.rowCount === 0) return;
    const d = dirRef.current;
    const g = graphRef.current;

    const totalW = graphWidth(g.rowCount, d, g.laneCount);
    const totalH = graphHeight(g.rowCount, d, g.laneCount);

    const scaleX = canvasWidth / totalW;
    const scaleY = canvasHeight / totalH;

    // For large graphs, don't try to fit everything — use comfortable zoom
    const fitScale = Math.min(scaleX, scaleY) * 0.9;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fitScale));

    // If graph is large (would need very small scale), use a comfortable zoom
    // and position at the start (newest commits)
    if (fitScale < 0.4 && g.rowCount > 150) {
      const comfortScale = Math.max(0.7, MIN_SCALE);
      onViewportChange({ scale: comfortScale, offsetX: 16, offsetY: 16 });
    } else {
      onViewportChange({ scale: newScale, offsetX: 16, offsetY: 16 });
    }
  }, [onViewportChange]);

  return { fitToView };
}
