// Stat tile: label + hero value (+ optional sub-line and embedded sparkline).
// Matches the existing settings/monitor tile styling; text stays in text
// tokens, the sparkline tint comes from `tone`.

import { cn } from '@/lib/utils';
import { Sparkline } from './Sparkline';

export function StatTile({ label, value, sub, trend, tone, className }: {
  label: string;
  value: string;
  /** Small secondary line under the value. */
  sub?: string;
  /** Recent values — rendered as an inline sparkline when present. */
  trend?: number[];
  /** Tint class for the sparkline (e.g. 'text-primary', 'text-amber-400'). */
  tone?: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border px-3 py-2 min-w-0', className)}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <div className="flex items-end justify-between gap-2 mt-0.5">
        <div className="min-w-0">
          <p className="text-sm font-mono text-foreground tabular-nums truncate">{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground/60 truncate">{sub}</p>}
        </div>
        {trend && trend.length > 1 && (
          <Sparkline data={trend} width={72} height={22} className={cn('flex-shrink-0', tone ?? 'text-primary/80')} />
        )}
      </div>
    </div>
  );
}
