import { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, Goal, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppDispatch, useAppSelector } from '@/store/store';
import { useActiveTurns } from '@/lib/agent/activeTurns';
import { formatCost } from '@/lib/agent/pricing';
import { loadUsage, summarize } from '@/lib/agent/usageLog';
import { Sparkline } from '@/components/ui/charts/Sparkline';
import UsageSection from '@/components/settings/UsageSection';
import GoalsTab from './GoalsTab';

// ─── Monitor dashboard (right-column view) ───────────────────────────────────
// Live agent status across the app: goal runs (Phase 6 executor), running
// sessions with Stop handles, and usage analytics. Complements the per-session
// chrome — this is the "what is the agent doing right now, everywhere" surface.

type Tab = 'goals' | 'sessions' | 'usage';

function elapsed(startedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function SessionsTab() {
  const dispatch = useAppDispatch();
  const turns = useActiveTurns();
  const sessions = useAppSelector((s) => s.sessions);
  const [now, setNow] = useState(() => Date.now());

  // Tick the elapsed clocks only while something is running.
  useEffect(() => {
    if (turns.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [turns.length]);

  const waiting = sessions.filter(
    (s) => !s.archived && (s.context.status === 'awaiting_approval' || s.context.status === 'awaiting_input'),
  );

  return (
    <div className="p-3 space-y-4">
      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
          Running turns ({turns.length})
        </h3>
        {turns.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/60">Nothing running.</p>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border/60">
            {turns.map((t) => (
              <div key={`${t.sessionId}-${t.startedAt}`} className="flex items-center gap-2 px-3 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                <button
                  className="text-xs text-foreground truncate flex-1 text-left hover:underline"
                  onClick={() => dispatch({ type: 'SET_ACTIVE_SESSION', id: t.sessionId })}
                  title="Switch to session"
                >
                  {t.title}
                </button>
                {t.source === 'goal' && (
                  <span className="px-1.5 py-0.5 rounded border border-primary/40 text-primary text-[9px] font-mono uppercase">goal</span>
                )}
                <span className="text-[10px] font-mono text-muted-foreground tabular-nums">{elapsed(t.startedAt, now)}</span>
                <button
                  onClick={t.stop}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-red-400 hover:border-red-400/40"
                  title="Stop this turn"
                >
                  <Square className="w-2.5 h-2.5" /> stop
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {waiting.length > 0 && (
        <div>
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            Waiting on you ({waiting.length})
          </h3>
          <div className="rounded-lg border border-border divide-y divide-border/60">
            {waiting.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <button
                  className="text-xs text-foreground truncate flex-1 text-left hover:underline"
                  onClick={() => dispatch({ type: 'SET_ACTIVE_SESSION', id: s.id })}
                >
                  {s.title}
                </button>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {s.context.status === 'awaiting_approval' ? 'needs approval' : 'has questions'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ActivitySection />

      <SessionCostFooter />
    </div>
  );
}

// Hourly token activity over the last 24h across all sessions — a quick pulse
// of how busy the agent has been (data from the usage log; one bucket/hour).
function ActivitySection() {
  const turns = useActiveTurns();
  const activity = useMemo(() => {
    const buckets = new Array<number>(24).fill(0);
    const now = Date.now();
    for (const e of loadUsage()) {
      const t = Date.parse(e.ts);
      if (Number.isNaN(t)) continue;
      const ageH = (now - t) / 3_600_000;
      if (ageH < 0 || ageH >= 24) continue;
      buckets[23 - Math.floor(ageH)] += e.input + e.output;
    }
    return buckets;
    // Re-bucket when a turn finishes (turns.length flips) — cheap enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length]);
  const total = activity.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
        Activity · last 24h
      </h3>
      <div className="rounded-lg border border-border px-3 py-2 text-primary/80">
        <Sparkline data={activity} width={260} height={32} className="w-full" />
        <p className="text-[10px] text-muted-foreground/60 mt-1">
          {total.toLocaleString()} tokens across {activity.filter((v) => v > 0).length} active hour{activity.filter((v) => v > 0).length === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  );
}

function SessionCostFooter() {
  const today = summarize({
    since: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); })(),
  });
  return (
    <p className="text-[10px] text-muted-foreground/50">
      Today: {today.totals.turns} model calls ·
      {' '}{(today.totals.input + today.totals.output).toLocaleString()} tokens
      {today.totals.costUSD > 0 ? ` · ≈${formatCost(today.totals.costUSD)}` : ''}
    </p>
  );
}

export default function MonitorPanel() {
  const [tab, setTab] = useState<Tab>('goals');
  const turns = useActiveTurns();

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'goals', label: 'Goals', icon: <Goal className="w-3 h-3" /> },
    { id: 'sessions', label: 'Sessions', icon: <Activity className="w-3 h-3" /> },
    { id: 'usage', label: 'Usage', icon: <BarChart3 className="w-3 h-3" /> },
  ];

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border flex-shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
              tab === t.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.icon}
            {t.label}
            {t.id === 'sessions' && turns.length > 0 && (
              <span className="px-1 rounded-full bg-green-500/15 text-green-500 text-[9px] font-mono">{turns.length}</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'goals' && <GoalsTab />}
        {tab === 'sessions' && <SessionsTab />}
        {tab === 'usage' && <div className="p-3"><UsageSection /></div>}
      </div>
    </div>
  );
}
