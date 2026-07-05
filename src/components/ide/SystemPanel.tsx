import { useEffect, useMemo, useState } from 'react';
import { HardDrive, ListTree, Network, Search, Skull, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePageVisible } from '@/hooks/usePageVisible';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { toast } from '@/services/toast';
import { getAppState } from '@/store/store';
import {
  fmtBytes, systemKill, systemPorts, systemProcesses,
  type PortInfo, type ProcInfo, type SystemSnapshot,
} from '@/lib/system';
import { useSystemStatsHistory } from '@/hooks/useSystemStatsHistory';
import { StatTile } from '@/components/ui/charts/StatTile';

// ─── System panel (expanded from the status bar) ─────────────────────────────
// Bottom sheet: sortable process table with guarded kill, listening TCP ports,
// disks, and the IDE's own children (terminals + sandboxes). The Rust side
// blocks PID ≤ 1 and foreign-user processes outright; the UI confirms every
// kill and marks system-ish names.

const POLL_MS = 2000;
const SYSTEMISH_RE = /^(systemd|init|kthreadd|dbus|Xorg|wayland|gnome-|kde|pipewire|NetworkManager|sshd)/i;

export default function SystemPanel({ onClose, snapshot }: {
  onClose: () => void;
  snapshot: SystemSnapshot | null;
}) {
  const pageVisible = usePageVisible();
  const statsHistory = useSystemStatsHistory();
  const [sort, setSort] = useState<'cpu' | 'mem'>('cpu');
  const [procs, setProcs] = useState<ProcInfo[]>([]);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [portsError, setPortsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [confirmKill, setConfirmKill] = useState<{ pid: number; name: string } | null>(null);

  useEffect(() => {
    if (!pageVisible) return;
    let alive = true;
    const tick = () => {
      systemProcesses(sort, 40).then((p) => { if (alive) setProcs(p); }).catch(() => {});
      systemPorts()
        .then((p) => { if (alive) { setPorts(p); setPortsError(null); } })
        .catch((e) => { if (alive) setPortsError(e instanceof Error ? e.message : String(e)); });
    };
    tick();
    const iv = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(iv); };
  }, [sort, pageVisible]);

  const shown = useMemo(() => {
    if (!search.trim()) return procs;
    const q = search.toLowerCase();
    return procs.filter((p) => p.name.toLowerCase().includes(q) || p.cmd.toLowerCase().includes(q) || String(p.pid).includes(q));
  }, [procs, search]);

  // IDE children: open terminals across sessions (best-effort from state).
  const ideChildren = useMemo(() => {
    const { sessions } = getAppState();
    const terminals = sessions.reduce((n, s) => n + s.terminals.length, 0);
    const sandboxed = sessions.filter((s) => s.context.sandbox?.enabled).length;
    return { terminals, sandboxed };
  }, []);

  const doKill = async (pid: number, name: string) => {
    try {
      await systemKill(pid);
      toast.success(`Killed ${name} (${pid})`);
      setProcs((prev) => prev.filter((p) => p.pid !== pid));
    } catch (e) {
      toast.error('Kill failed', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-6 z-40 h-[46vh] border-t border-border bg-background shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 h-9 border-b border-border flex-shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">System</span>
        {snapshot && (
          <span className="text-[10px] font-mono text-muted-foreground/70">
            up {Math.floor(snapshot.uptimeSecs / 3600)}h · swap {fmtBytes(snapshot.swapUsed)}/{fmtBytes(snapshot.swapTotal)}
            {' '}· IDE children: {ideChildren.terminals} terminals{ideChildren.sandboxed > 0 ? `, ${ideChildren.sandboxed} sandboxed sessions` : ''}
          </span>
        )}
        <button onClick={onClose} title="Close" className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Vitals: current value + recent trend from the shared 2s-poll buffer. */}
      {snapshot && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 py-2 border-b border-border/60 flex-shrink-0">
          <StatTile
            label="CPU"
            value={`${snapshot.cpuPct.toFixed(0)}%`}
            sub={`${snapshot.cpuCount} cores · load ${snapshot.loadAvgOne.toFixed(2)}`}
            trend={statsHistory.map((s) => s.cpuPct)}
            tone={snapshot.cpuPct >= 90 ? 'text-red-400' : snapshot.cpuPct >= 70 ? 'text-amber-400' : 'text-primary/80'}
          />
          <StatTile
            label="Memory"
            value={fmtBytes(snapshot.memUsed)}
            sub={`of ${fmtBytes(snapshot.memTotal)}`}
            trend={statsHistory.map((s) => s.memUsed)}
            tone="text-primary/80"
          />
          <StatTile
            label="IDE memory"
            value={fmtBytes(snapshot.appMem)}
            sub={`app CPU ${snapshot.appCpuPct.toFixed(0)}%`}
            trend={statsHistory.map((s) => s.appMem)}
            tone="text-primary/80"
          />
          <StatTile
            label="Swap"
            value={fmtBytes(snapshot.swapUsed)}
            sub={`of ${fmtBytes(snapshot.swapTotal)}`}
            trend={statsHistory.map((s) => s.swapUsed)}
            tone="text-primary/80"
          />
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Processes */}
        <div className="flex-1 min-w-0 flex flex-col border-r border-border">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 flex-shrink-0">
            <ListTree className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Processes</span>
            <div className="inline-flex items-center gap-0.5 p-0.5 rounded border border-border">
              {(['cpu', 'mem'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={cn('px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold',
                    sort === k ? 'bg-accent text-foreground' : 'text-muted-foreground')}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1 text-muted-foreground">
              <Search className="w-3 h-3" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="filter…"
                className="w-28 text-[10px] bg-transparent border-b border-border focus:outline-none focus:border-ring"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-[10px] font-mono">
              <thead className="sticky top-0 bg-background text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-1 font-medium">PID</th>
                  <th className="px-2 py-1 font-medium">Name</th>
                  <th className="px-2 py-1 font-medium text-right">CPU</th>
                  <th className="px-2 py-1 font-medium text-right">Mem</th>
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.pid} className="border-t border-border/30 hover:bg-accent/20" title={p.cmd}>
                    <td className="px-3 py-0.5 text-muted-foreground">{p.pid}</td>
                    <td className="px-2 py-0.5 truncate max-w-[220px]">
                      {p.name}
                      {SYSTEMISH_RE.test(p.name) && <span className="ml-1 text-amber-500/80" title="System process">⚠</span>}
                    </td>
                    <td className={cn('px-2 py-0.5 text-right tabular-nums', p.cpuPct > 50 && 'text-amber-400')}>{p.cpuPct.toFixed(1)}%</td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{fmtBytes(p.memBytes)}</td>
                    <td className="px-2 py-0.5 text-right">
                      {p.isOwn && (
                        <button
                          onClick={() => setConfirmKill({ pid: p.pid, name: p.name })}
                          title="Kill process"
                          className="p-0.5 rounded text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10"
                        >
                          <Skull className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column: ports + disks */}
        <div className="w-[280px] flex-shrink-0 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60">
            <Network className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Listening ports</span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {portsError
              ? <p className="px-3 py-2 text-[10px] text-amber-500">{portsError}</p>
              : ports.length === 0
                ? <p className="px-3 py-2 text-[10px] text-muted-foreground/60">No listening TCP ports.</p>
                : ports.map((p) => (
                  <div key={p.port} className="flex items-center gap-2 px-3 py-1 text-[10px] font-mono border-b border-border/20">
                    <span className="text-foreground tabular-nums w-12">:{p.port}</span>
                    <span className="text-muted-foreground truncate flex-1">{p.process ?? '—'}</span>
                    {p.pid !== null && (
                      <button
                        onClick={() => setConfirmKill({ pid: p.pid!, name: p.process ?? `pid ${p.pid}` })}
                        title="Kill the process owning this port"
                        className="p-0.5 rounded text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10"
                      >
                        <Skull className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 border-y border-border/60">
            <HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Disks</span>
          </div>
          <div className="max-h-[30%] overflow-auto">
            {(snapshot?.disks ?? []).map((d) => {
              const pct = d.totalBytes > 0 ? (d.usedBytes / d.totalBytes) * 100 : 0;
              return (
                <div key={d.mount} className="px-3 py-1">
                  <div className="flex items-center gap-2 text-[10px] font-mono">
                    <span className="truncate flex-1" title={d.mount}>{d.mount}</span>
                    <span className={cn('tabular-nums', pct > 90 ? 'text-red-400' : 'text-muted-foreground')}>
                      {fmtBytes(d.usedBytes)}/{fmtBytes(d.totalBytes)}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden mt-0.5">
                    <div className={cn('h-full rounded-full', pct > 90 ? 'bg-red-500' : 'bg-primary/70')} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmKill}
        title={confirmKill ? `Kill ${confirmKill.name} (${confirmKill.pid})?` : ''}
        description={confirmKill && SYSTEMISH_RE.test(confirmKill.name)
          ? '⚠ This looks like a SYSTEM process — killing it can log you out or destabilize the machine.'
          : 'The process receives a kill signal and any unsaved work in it is lost.'}
        confirmLabel="Kill"
        variant="destructive"
        onConfirm={() => { if (confirmKill) void doKill(confirmKill.pid, confirmKill.name); setConfirmKill(null); }}
        onCancel={() => setConfirmKill(null)}
      />
    </div>
  );
}
