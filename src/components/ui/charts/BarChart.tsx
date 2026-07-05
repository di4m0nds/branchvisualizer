// Single-series vertical bar chart. Thin bars with rounded data-ends anchored
// to the baseline, 2px gaps, recessive baseline, per-bar hover tooltip +
// highlight. Bars inherit currentColor (tint via text-* class); all text stays
// in text tokens, never the series color.

import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface BarDatum {
  label: string;
  value: number;
}

export function BarChart({
  data, height = 96, formatValue = (v) => String(v), className, barClassName,
}: {
  data: BarDatum[];
  height?: number;
  formatValue?: (v: number) => string;
  className?: string;
  /** Tint class for the bars (defaults to the primary token). */
  barClassName?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  // Label cadence: show at most ~7 x labels so they never collide.
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));

  return (
    <div className={cn('w-full', className)}>
      {/* Hover readout row — a stable-height slot so the chart doesn't jump. */}
      <div className="h-4 mb-0.5 text-[10px] font-mono text-muted-foreground tabular-nums truncate">
        {hover !== null && data[hover]
          ? <>{data[hover].label} · <span className="text-foreground">{formatValue(data[hover].value)}</span></>
          : <span className="text-muted-foreground/50">max {formatValue(max)}</span>}
      </div>
      <div className="flex items-end gap-[2px]" style={{ height }} role="img" aria-label="bar chart">
        {data.map((d, i) => {
          const h = d.value <= 0 ? 0 : Math.max(3, Math.round((d.value / max) * height));
          return (
            <div
              key={`${d.label}-${i}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((cur) => (cur === i ? null : cur))}
              title={`${d.label}: ${formatValue(d.value)}`}
              className="flex-1 min-w-[3px] h-full flex items-end cursor-default"
            >
              <div
                className={cn(
                  'w-full rounded-t-[4px] transition-opacity',
                  d.value <= 0 ? 'bg-border/40 h-px' : cn('bg-current', barClassName ?? 'text-primary/80'),
                  hover !== null && hover !== i && 'opacity-40',
                )}
                style={d.value > 0 ? { height: h } : undefined}
              />
            </div>
          );
        })}
      </div>
      {/* Recessive baseline + sparse x labels in text tokens. */}
      <div className="border-t border-border/60 mt-0.5 flex gap-[2px]">
        {data.map((d, i) => (
          <span
            key={`${d.label}-${i}`}
            className="flex-1 min-w-[3px] pt-0.5 text-center text-[9px] text-muted-foreground/60 truncate"
          >
            {i % labelEvery === 0 ? d.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
