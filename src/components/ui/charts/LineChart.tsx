// Small multi-point line chart with a recessive baseline grid, min/max labels
// in text tokens, and a crosshair hover readout. Single series by design (one
// hue via currentColor) — for a second measure render a second chart, never a
// second axis.

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface LinePoint {
  label: string;
  value: number;
}

export function LineChart({
  data, height = 96, formatValue = (v) => String(v), className, lineClassName,
}: {
  data: LinePoint[];
  height?: number;
  formatValue?: (v: number) => string;
  className?: string;
  /** Tint class for the line (defaults to the primary token). */
  lineClassName?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return null;

  const W = 100; // percentage-based viewBox; container controls real width
  const min = Math.min(...data.map((d) => d.value));
  const max = Math.max(...data.map((d) => d.value));
  const span = max - min || 1;
  const pad = 3;
  const stepX = (W - pad * 2) / (data.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const pts = data.map((d, i) => [pad + i * stepX, y(d.value)] as const);
  const path = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)}`).join(' ');

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(Math.min(data.length - 1, Math.max(0, Math.round(frac * (data.length - 1)))));
  };

  return (
    <div className={cn('w-full', className)}>
      <div className="h-4 mb-0.5 text-[10px] font-mono text-muted-foreground tabular-nums truncate">
        {hover !== null && data[hover]
          ? <>{data[hover].label} · <span className="text-foreground">{formatValue(data[hover].value)}</span></>
          : <>min {formatValue(min)} · max {formatValue(max)}</>}
      </div>
      <div
        ref={wrapRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        className="relative w-full cursor-default"
        style={{ height }}
      >
        <svg
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full overflow-visible"
          role="img"
          aria-label="line chart"
        >
          {/* Recessive grid: baseline + midline only. */}
          <line x1={pad} y1={height - pad} x2={W - pad} y2={height - pad} className="stroke-border/60" strokeWidth="0.5" />
          <line x1={pad} y1={height / 2} x2={W - pad} y2={height / 2} className="stroke-border/30" strokeWidth="0.5" strokeDasharray="1.5 2" />
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className={lineClassName ?? 'text-primary/80'}
          />
          {hover !== null && pts[hover] && (
            <g className={lineClassName ?? 'text-primary'}>
              <line x1={pts[hover][0]} y1={pad} x2={pts[hover][0]} y2={height - pad} className="stroke-border" strokeWidth="0.5" />
              {/* ≥8px marker with a 2px surface ring. */}
              <circle cx={pts[hover][0]} cy={pts[hover][1]} r="4" fill="currentColor" className="stroke-background" strokeWidth="2" />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
