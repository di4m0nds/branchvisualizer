import { useMemo, useState } from 'react';
import { useAppSelector } from '@/store/store';
import { loadUsage, summarize } from '@/lib/agent/usageLog';
import { formatCost } from '@/lib/agent/pricing';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/Select';
import { BarChart, type BarDatum } from '@/components/ui/charts/BarChart';

// ─── Settings → Usage ────────────────────────────────────────────────────────
// Token/cost analytics from the usage log (per model, per project, per task),
// with a time-range filter. Read-only telemetry; the enforcement lever lives
// in Settings → Execution.

type Range = 'today' | '7d' | '30d' | 'all';

function sinceFor(range: Range): string | undefined {
  if (range === 'all') return undefined;
  const d = new Date();
  if (range === 'today') d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - (range === '7d' ? 7 : 30));
  return d.toISOString();
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <p className="text-sm font-mono text-foreground tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function BreakdownTable({ title, rows }: {
  title: string;
  rows: Array<{ key: string; label: string; input: number; output: number; costUSD: number; turns: number }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
      <div className="rounded-lg border border-border divide-y divide-border/60">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 px-3 py-2">
            <span className="text-xs text-foreground truncate flex-1" title={r.key}>{r.label}</span>
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums">{r.turns} calls</span>
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-28 text-right">
              {r.input.toLocaleString()} in · {r.output.toLocaleString()} out
            </span>
            <span className="text-[11px] font-mono text-foreground tabular-nums w-16 text-right">
              {r.costUSD > 0 ? `≈${formatCost(r.costUSD)}` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UsageSection() {
  const [range, setRange] = useState<Range>('7d');
  const projects = useAppSelector((s) => s.projects);
  const sessions = useAppSelector((s) => s.sessions);

  const { sum, entries } = useMemo(() => {
    const since = sinceFor(range);
    return { sum: summarize(since ? { since } : {}), entries: loadUsage().length };
  }, [range]);

  // Time-bucketed series for the charts: hourly for Today, daily otherwise
  // ('all' shows the last 30 days — the log is capped anyway).
  const { costSeries, tokenSeries } = useMemo(() => {
    const hourly = range === 'today';
    const days = range === '7d' ? 7 : 30;
    const buckets: { key: string; label: string; cost: number; tokens: number }[] = [];
    const index = new Map<string, number>();
    const now = new Date();
    const count = hourly ? 24 : days;
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now);
      if (hourly) { d.setHours(d.getHours() - i, 0, 0, 0); } else { d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0); }
      const key = hourly
        ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`
        : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      index.set(key, buckets.length);
      buckets.push({
        key,
        label: hourly ? `${String(d.getHours()).padStart(2, '0')}h` : `${d.getDate()}/${d.getMonth() + 1}`,
        cost: 0,
        tokens: 0,
      });
    }
    for (const e of loadUsage()) {
      const t = new Date(e.ts);
      if (Number.isNaN(t.getTime())) continue;
      const key = hourly
        ? `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}-${t.getHours()}`
        : `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
      const at = index.get(key);
      if (at === undefined) continue;
      buckets[at].cost += e.costUSD ?? 0;
      buckets[at].tokens += e.input + e.output;
    }
    return {
      costSeries: buckets.map((b): BarDatum => ({ label: b.label, value: b.cost })),
      tokenSeries: buckets.map((b): BarDatum => ({ label: b.label, value: b.tokens })),
    };
  }, [range]);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id ?? '(unknown)';
  const sessionName = (id: string) => sessions.find((s) => s.id === id)?.title ?? id;

  const toRows = (
    bucket: Record<string, { input: number; output: number; costUSD: number; turns: number }>,
    label: (k: string) => string,
    cap = 12,
  ) =>
    Object.entries(bucket)
      .map(([key, v]) => ({ key, label: label(key), ...v }))
      .sort((a, b) => b.costUSD - a.costUSD || b.output - a.output)
      .slice(0, cap);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Usage</h2>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Token consumption and approximate cost, recorded per model call ({entries} log entries).
          </p>
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as Range)}>
          <SelectTrigger className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <Stat label="Model calls" value={sum.totals.turns.toLocaleString()} />
        <Stat label="Input tokens" value={sum.totals.input.toLocaleString()} />
        <Stat label="Output tokens" value={sum.totals.output.toLocaleString()} />
        <Stat label="≈ Cost" value={sum.totals.costUSD > 0 ? `≈${formatCost(sum.totals.costUSD)}` : '—'} />
      </div>

      {sum.totals.turns === 0 ? (
        <p className="text-[11px] text-muted-foreground/60">No usage in this range — analytics appear after agent turns.</p>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div className="rounded-lg border border-border px-3 py-2">
              <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                ≈ Cost {range === 'today' ? 'per hour' : 'per day'}
              </h3>
              <BarChart data={costSeries} height={72} formatValue={(v) => (v > 0 ? `≈${formatCost(v)}` : '$0')} />
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                Tokens {range === 'today' ? 'per hour' : 'per day'}
              </h3>
              <BarChart data={tokenSeries} height={72} formatValue={(v) => v.toLocaleString()} barClassName="text-sky-400/80" />
            </div>
          </div>
          <BreakdownTable title="By model" rows={toRows(sum.byModel, (k) => k)} />
          <BreakdownTable title="By project" rows={toRows(sum.byProject, projectName)} />
          <BreakdownTable title="By session" rows={toRows(sum.bySession, sessionName)} />
        </>
      )}
      <p className="text-[10px] text-muted-foreground/60 mt-2">
        ≈ Estimated from a static price table (never live billing) — see Settings → Models & Cost
        for how costs are computed. Subscription CLIs may not bill per token.
      </p>
    </div>
  );
}
