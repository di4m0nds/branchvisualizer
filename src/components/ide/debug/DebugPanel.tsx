import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Bug, Pause, Play, Send, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { recentLogs, subscribeLogs, type LogEntry, type LogLevel } from '@/lib/log';
import { prefillChat } from '@/hooks/useSendToChat';
import { useActiveSession } from '@/hooks/useActiveSession';
import { toast } from '@/services/toast';

// ─── Unified log inspector ───────────────────────────────────────────────────
// One timestamp-sorted stream across the IDE's debugging sources:
//   app    — the structured log ring (src/lib/log.ts: warns, swallows, errors)
//   agent  — the active session's tool executions and errors
// Filter by source/level, search, pause, copy, and hand any entry to the agent
// (prefills the composer — never auto-sends). Container logs live in the
// Runtime panel (per-container follow) — this stream stays host-side.

type Source = 'app' | 'agent';

interface Row {
  ts: number;
  source: Source;
  level: LogLevel;
  scope: string;
  text: string;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-muted-foreground/60',
  info: 'text-foreground/80',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const MAX_ROWS = 1000;

function appRow(e: LogEntry): Row {
  return { ts: e.ts, source: 'app', level: e.level, scope: e.scope, text: e.msg };
}

export default memo(function DebugPanel() {
  const active = useActiveSession();
  const [appRows, setAppRows] = useState<Row[]>(() => recentLogs().map(appRow));
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState('');
  const [sources, setSources] = useState<Record<Source, boolean>>({ app: true, agent: true });
  const [minLevel, setMinLevel] = useState<LogLevel>('debug');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Live app-log tail.
  useEffect(() => subscribeLogs((e) => {
    if (pausedRef.current) return;
    setAppRows((prev) => {
      const next = [...prev, appRow(e)];
      if (next.length > MAX_ROWS) next.splice(0, next.length - MAX_ROWS);
      return next;
    });
  }), []);

  // Agent activity rows derived from the active session's structured blocks.
  const agentRows = useMemo<Row[]>(() => {
    if (!active) return [];
    const rows: Row[] = [];
    for (const m of active.messages) {
      for (const b of m.blocks) {
        const ts = new Date(m.ts).getTime() || Date.now();
        if (b.type === 'action_log') {
          const d = b.data ?? {};
          rows.push({
            ts,
            source: 'agent',
            level: d.status === 'error' ? 'error' : 'info',
            scope: String(d.tool ?? 'tool'),
            text: `${String(d.description ?? '')}${d.output ? ` — ${String(d.output).slice(0, 200)}` : ''}`,
          });
        } else if (b.type === 'agent_error' || b.type === 'error_triage') {
          const d = b.data ?? {};
          rows.push({
            ts,
            source: 'agent',
            level: 'error',
            scope: b.type,
            text: String(d.message ?? d.command ?? b.raw).slice(0, 300),
          });
        }
      }
    }
    return rows;
  }, [active]);

  const rows = useMemo(() => {
    const rank: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    const min = rank[minLevel];
    const merged = [...(sources.app ? appRows : []), ...(sources.agent ? agentRows : [])]
      .filter((r) => rank[r.level] >= min)
      .filter((r) => !search
        || r.text.toLowerCase().includes(search.toLowerCase())
        || r.scope.toLowerCase().includes(search.toLowerCase()));
    merged.sort((a, b) => a.ts - b.ts);
    return merged.slice(-MAX_ROWS);
  }, [appRows, agentRows, sources, minLevel, search]);

  const handToAgent = (r: Row) => {
    if (!active) { toast.error('No active session'); return; }
    const block = `Please look at this ${r.level} from the IDE's ${r.source} log (scope: ${r.scope}):\n\`\`\`\n${r.text}\n\`\`\``;
    if (prefillChat(active.id, block)) toast.success('Added to the chat composer');
    else toast.error('Chat composer unavailable');
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border flex-shrink-0">
        <Bug className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Debug</span>
        {(['app', 'agent'] as const).map((src) => (
          <button
            key={src}
            onClick={() => setSources((s) => ({ ...s, [src]: !s[src] }))}
            className={cn('px-1.5 py-0.5 rounded text-[10px] border transition-colors',
              sources[src] ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
          >
            {src}
          </button>
        ))}
        <select
          value={minLevel}
          onChange={(e) => setMinLevel(e.target.value as LogLevel)}
          className="text-[10px] bg-background border border-border rounded px-1 py-0.5"
          title="Minimum level"
        >
          {(['debug', 'info', 'warn', 'error'] as const).map((l) => <option key={l} value={l}>{l}+</option>)}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs…"
          className="flex-1 min-w-0 text-[11px] bg-background border border-border rounded px-2 py-0.5"
        />
        <button
          onClick={() => setPaused((v) => !v)}
          title={paused ? 'Resume tail' : 'Pause tail'}
          className={cn('p-1 rounded transition-colors', paused ? 'text-amber-400' : 'text-muted-foreground hover:text-foreground')}
        >
          {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Stream */}
      <div className="flex-1 min-h-0 overflow-auto font-mono text-[10.5px] leading-relaxed">
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
            Nothing yet — logs and agent activity appear here as they happen.
          </div>
        ) : rows.map((r, i) => (
          <div key={i} className="group flex items-start gap-2 px-3 py-0.5 border-b border-border/20 hover:bg-accent/20">
            <span className="text-muted-foreground/50 tabular-nums flex-shrink-0">
              {new Date(r.ts).toLocaleTimeString()}
            </span>
            <span className={cn('flex-shrink-0 w-9 uppercase text-[9px] pt-0.5', LEVEL_COLORS[r.level])}>{r.level}</span>
            <span className="text-muted-foreground/70 flex-shrink-0">[{r.source}:{r.scope}]</span>
            <span className="min-w-0 break-all flex-1">{r.text}</span>
            <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
              <button
                onClick={() => { void navigator.clipboard.writeText(r.text); toast.success('Copied'); }}
                title="Copy" className="p-0.5 text-muted-foreground hover:text-foreground"
              >
                <Copy className="w-3 h-3" />
              </button>
              <button onClick={() => handToAgent(r)} title="Send to agent (prefills the composer)" className="p-0.5 text-muted-foreground hover:text-primary">
                <Send className="w-3 h-3" />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
