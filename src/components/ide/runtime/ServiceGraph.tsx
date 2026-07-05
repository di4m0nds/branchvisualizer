import { useEffect, useMemo, useRef } from 'react';
import { renderGraph, graphWidth, graphHeight } from '@/graph/renderer';
import { composeToGraphData } from '@/lib/runtimeGraph';
import { useAppSelector } from '@/store/store';
import type { ComposeService } from '@/types/runtime';

// Static canvas render of the compose service-dependency DAG, reusing the git
// graph engine via the compose→Commit adapter. No interaction/animation — one
// fit-to-view draw, redrawn on resize/theme (keeps it cheap; see §4.1).
export default function ServiceGraph({ services }: { services: ComposeService[] }) {
  const theme = useAppSelector((s) => s.theme);
  const graphData = useMemo(() => composeToGraphData(services), [services]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const contentW = graphWidth(graphData.rowCount, 'vertical', graphData.laneCount) || 1;
      const contentH = graphHeight(graphData.rowCount, 'vertical', graphData.laneCount) || 1;
      // Fit, but keep scale ≥ 0.4 so the renderer still draws service labels.
      const fit = Math.min(w / (contentW + 32), h / (contentH + 32));
      const scale = Math.max(0.4, Math.min(1, fit));

      renderGraph(ctx, graphData, {
        width: w,
        height: h,
        scale,
        offsetX: 16,
        offsetY: 16,
        selectedSha: null,
        hoveredSha: null,
        highlightedShas: null,
        showMessages: true,
        theme,
      });
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [graphData, theme]);

  if (services.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        No compose services to graph.
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
