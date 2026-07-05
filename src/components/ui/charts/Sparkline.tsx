// Minimal inline trend line (no axes, no grid). Stroke inherits currentColor —
// tint via a text-* class on the caller; labels/values stay in text tokens.

import { useId } from 'react';
import { cn } from '@/lib/utils';

export function Sparkline({ data, width = 96, height = 24, fill = true, className }: {
  data: number[];
  width?: number;
  height?: number;
  /** Soft area fill under the line (10% opacity). */
  fill?: boolean;
  className?: string;
}) {
  const gid = useId();
  if (data.length < 2) {
    return <svg width={width} height={height} className={cn('block', className)} aria-hidden />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 2; // keep the 2px stroke inside the viewBox
  const stepX = (width - pad * 2) / (data.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const points = data.map((v, i) => [pad + i * stepX, y(v)] as const);
  const line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${height - pad} L${pad},${height - pad} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('block overflow-visible', className)}
      role="img"
      aria-label={`trend, latest ${data[data.length - 1]}`}
    >
      {fill && <path d={area} fill={`url(#${gid})`} stroke="none" />}
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
