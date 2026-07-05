import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Play, Square, RotateCw, Trash2, Download, Hammer,
  Boxes, ScrollText, Network, AlertTriangle, ArrowUpCircle, ArrowDownCircle,
  Cpu, MemoryStick, RotateCcw, CornerDownLeft, SquareTerminal, Settings2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/platform';
import { useActiveSession } from '@/hooks/useActiveSession';
import { usePageVisible } from '@/hooks/usePageVisible';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ServiceGraph from './ServiceGraph';
import InspectDrawer from './InspectDrawer';
import {
  isSandboxContainer, loadEngine, loadIntervals, saveEngine, saveIntervals,
  type RuntimeIntervals,
} from './runtimePrefs';
import {
  runtimeDetect, dockerPs, dockerComposeServices, dockerAction, dockerKill, dockerExec,
  dockerStatsStream, dockerLogsStream, onRuntimeData, onRuntimeExit, parseStatsLine,
  type DockerAction,
} from '@/lib/runtime';
import type {
  RuntimeInfo, Container, ComposeService, ContainerEngine, ContainerStats, Diagnostic,
} from '@/types/runtime';
import type { Unlisten } from '@/lib/platform';

type Tab = 'containers' | 'services' | 'logs' | 'diagnostics';
const DESTRUCTIVE: ReadonlySet<DockerAction> = new Set(['prune', 'rm', 'down']);
const MAX_LOG_LINES = 2000;
const ERROR_RE = /\b(err(or)?|fatal|panic|exception|fail(ed|ure)?)\b/i;

// Memoized: no props, so parent-driven re-renders (IdeWorkspace re-renders per
// streamed token) are free; internal state/polling drives its own updates.
export default memo(function RuntimePanel() {
  const active = useActiveSession();
  const cwd = active?.repoSource === 'local' ? active.cwd : null;
  // Pause polling while the window is hidden/minimized.
  const pageVisible = usePageVisible();

  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [tab, setTab] = useState<Tab>('containers');
  const [containers, setContainers] = useState<Container[]>([]);
  const [services, setServices] = useState<ComposeService[]>([]);
  const [stats, setStats] = useState<Record<string, ContainerStats>>({});
  const [confirm, setConfirm] = useState<{ action: DockerAction; target: string | null; label: string; sandbox: boolean } | null>(null);
  // User's preferred engine (persisted); honored even when its daemon is dead
  // so failures surface visibly instead of silently switching.
  const [preferred, setPreferred] = useState<ContainerEngine | null>(loadEngine);
  const [intervals, setIntervals] = useState<RuntimeIntervals>(loadIntervals);
  const [gearOpen, setGearOpen] = useState(false);
  const [psError, setPsError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Container | null>(null);
  const [execRequest, setExecRequest] = useState<string | null>(null);

  // ── Detection (on project change) ─────────────────────────────────────
  useEffect(() => {
    if (!isTauri() || !cwd) { setInfo(null); return; }
    let cancelled = false;
    setDetecting(true);
    runtimeDetect(cwd, preferred)
      .then((i) => { if (!cancelled) setInfo(i); })
      .catch(() => { if (!cancelled) setInfo(null); })
      .finally(() => { if (!cancelled) setDetecting(false); });
    return () => { cancelled = true; };
  }, [cwd, preferred]);

  // Honor the user's switch even for a dead engine (errors then show in the banner).
  const engine = (preferred && info?.engines.some((e) => e.name === preferred))
    ? preferred
    : info?.engine ?? null;

  // ── Load containers + services (poll ps every 3s) ─────────────────────
  const refresh = useCallback(async () => {
    if (!engine) return;
    try {
      const [ps, comp] = await Promise.allSettled([
        dockerPs(engine),
        cwd && info?.composeFile ? dockerComposeServices(engine, cwd) : Promise.resolve({ services: [] }),
      ]);
      if (ps.status === 'fulfilled') { setContainers(ps.value); setPsError(null); }
      else setPsError(ps.reason instanceof Error ? ps.reason.message : String(ps.reason));
      if (comp.status === 'fulfilled') setServices(comp.value.services);
    } catch { /* transient */ }
  }, [engine, cwd, info?.composeFile]);

  useEffect(() => {
    if (!engine) { setContainers([]); setServices([]); return; }
    if (!pageVisible) return; // paused while hidden; re-arms (with refresh) on show
    void refresh();
    const iv = setInterval(() => void refresh(), intervals.psMs);
    return () => clearInterval(iv);
  }, [engine, refresh, pageVisible, intervals.psMs]);

  // ── Live stats stream (while on Containers tab) ───────────────────────
  const statsRef = useRef<Record<string, ContainerStats>>({});
  useEffect(() => {
    if (!engine || tab !== 'containers' || !isTauri() || !pageVisible) return;
    const id = 'runtime-stats';
    let unlistenData: Unlisten | undefined;
    let unlistenExit: Unlisten | undefined;
    let flush: ReturnType<typeof setInterval> | undefined;
    let disposed = false;

    (async () => {
      unlistenData = await onRuntimeData(id, (line) => {
        const s = parseStatsLine(line);
        if (s) statsRef.current[s.name] = s;
      });
      unlistenExit = await onRuntimeExit(id, () => { /* stream ended; will restart on re-enter */ });
      if (disposed) return;
      await dockerStatsStream(id, engine).catch(() => {});
      flush = setInterval(() => setStats({ ...statsRef.current }), intervals.statsMs);
    })();

    return () => {
      disposed = true;
      if (flush) clearInterval(flush);
      unlistenData?.();
      unlistenExit?.();
      void dockerKill(id);
    };
  }, [engine, tab, pageVisible, intervals.statsMs]);

  // ── Diagnostics (derived) ─────────────────────────────────────────────
  const diagnostics = useMemo(
    () => computeDiagnostics(services, containers),
    [services, containers],
  );

  // ── Actions ───────────────────────────────────────────────────────────
  const runAction = useCallback(async (action: DockerAction, target: string | null) => {
    if (!engine) return;
    try {
      const res = await dockerAction(engine, action, target, cwd);
      if (res.code !== 0 && res.stderr.trim()) toast.error(res.stderr.trim().split('\n')[0]);
      else toast.success(`${action}${target ? ` ${target}` : ''} ok`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      void refresh();
    }
  }, [engine, cwd, refresh]);

  const requestAction = useCallback((action: DockerAction, target: string | null, label: string) => {
    const sandbox = !!target && containers.some(
      (c) => (c.id === target || c.name === target) && isSandboxContainer(c.name),
    );
    // Sandbox containers gate `stop` too — killing one interrupts the agent.
    if (DESTRUCTIVE.has(action) || (sandbox && action === 'stop')) {
      setConfirm({ action, target, label, sandbox });
    } else void runAction(action, target);
  }, [runAction, containers]);

  const switchEngine = useCallback((name: ContainerEngine) => {
    saveEngine(name);
    setPreferred(name);
    setPsError(null);
  }, []);

  const updateIntervals = useCallback((patch: Partial<RuntimeIntervals>) => {
    setIntervals((prev) => {
      const next = { ...prev, ...patch };
      saveIntervals(next);
      return next;
    });
  }, []);

  // ── Guards / empty states ─────────────────────────────────────────────
  if (!isTauri()) return <Empty icon={Boxes} msg="Runtime panel is available in the desktop app." />;
  if (!active || active.repoSource !== 'local' || !cwd) {
    return <Empty icon={Boxes} msg="Open a local project to inspect its container runtime." />;
  }
  if (detecting && !info) return <Empty icon={RefreshCw} msg="Detecting container runtime…" spin />;
  if (!engine) {
    return <Empty icon={Boxes} msg="No Docker or Podman found on PATH. Install one to use this panel." />;
  }

  const engines = info?.engines ?? [];

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* Header: engine switcher + tabs + refresh */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border flex-shrink-0">
        {engines.length > 1 ? (
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border bg-muted/30">
            {engines.map((e) => (
              <button
                key={e.name}
                onClick={() => switchEngine(e.name)}
                title={e.alive ? (e.version ?? e.name) : `${e.name} installed but its daemon/service is not responding`}
                className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors',
                  engine === e.name ? 'bg-accent text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {e.name}
                {!e.alive && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="daemon down" />}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-[11px] font-mono text-muted-foreground truncate" title={info?.version ?? ''}>
            {engine}
          </span>
        )}
        {info?.composeFile && (
          <span className="text-[11px] font-mono text-muted-foreground truncate">{info.composeFile}</span>
        )}
        <div className="ml-2 flex items-center gap-0.5">
          <TabBtn active={tab === 'containers'} onClick={() => setTab('containers')} icon={Boxes} label="Containers" />
          <TabBtn active={tab === 'services'} onClick={() => setTab('services')} icon={Network} label="Services" />
          <TabBtn active={tab === 'logs'} onClick={() => setTab('logs')} icon={ScrollText} label="Logs" />
          <TabBtn active={tab === 'diagnostics'} onClick={() => setTab('diagnostics')} icon={AlertTriangle} label="Diagnostics" badge={diagnostics.length || undefined} />
        </div>
        <div className="ml-auto flex items-center gap-1">
          {info?.composeFile && (
            <>
              <IconBtn title="compose up -d" onClick={() => requestAction('up', null, '')}><ArrowUpCircle className="w-3.5 h-3.5" /></IconBtn>
              <IconBtn title="compose down" onClick={() => requestAction('down', null, 'compose down')}><ArrowDownCircle className="w-3.5 h-3.5" /></IconBtn>
              <IconBtn title="compose pull" onClick={() => requestAction('pull', null, '')}><Download className="w-3.5 h-3.5" /></IconBtn>
              <IconBtn title="compose build" onClick={() => requestAction('build', null, '')}><Hammer className="w-3.5 h-3.5" /></IconBtn>
            </>
          )}
          <IconBtn title="Prune (system prune -f)" onClick={() => requestAction('prune', null, 'system prune')}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn title="Poll intervals" onClick={() => setGearOpen((v) => !v)}><Settings2 className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn title="Refresh" onClick={() => void refresh()}><RefreshCw className="w-3.5 h-3.5" /></IconBtn>
        </div>
      </div>

      {/* Poll-interval settings */}
      {gearOpen && (
        <div className="absolute right-2 top-9 z-20 rounded-lg border border-border bg-popover shadow-xl p-3 space-y-2 text-[11px]">
          <IntervalSelect label="Containers poll" value={intervals.psMs}
            options={[[1000, '1s'], [3000, '3s'], [5000, '5s'], [10000, '10s']]}
            onChange={(v) => updateIntervals({ psMs: v })} />
          <IntervalSelect label="Stats flush" value={intervals.statsMs}
            options={[[1000, '1s'], [1500, '1.5s'], [3000, '3s']]}
            onChange={(v) => updateIntervals({ statsMs: v })} />
          <IntervalSelect label="Logs flush" value={intervals.logsMs}
            options={[[200, '200ms'], [400, '400ms'], [1000, '1s']]}
            onChange={(v) => updateIntervals({ logsMs: v })} />
        </div>
      )}

      {/* Engine error banner (e.g. dead daemon on the selected engine) */}
      {psError && (
        <div className="flex items-start gap-2 px-3 py-1.5 border-b border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-500 flex-shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          <span className="min-w-0 break-all">{psError}</span>
          <button onClick={() => setPsError(null)} className="ml-auto p-0.5 hover:text-foreground" title="Dismiss">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'containers' && (
          <ContainersTab
            containers={containers}
            stats={stats}
            onAction={requestAction}
            onInspect={setInspect}
            onOpenShell={(id) => { setExecRequest(id); setTab('logs'); }}
          />
        )}
        {tab === 'services' && <ServicesTab services={services} />}
        {tab === 'logs' && (
          <LogsTab
            engine={engine}
            cwd={cwd}
            containers={containers}
            services={services}
            hasCompose={!!info?.composeFile}
            logsFlushMs={intervals.logsMs}
            execRequest={execRequest}
            onExecHandled={() => setExecRequest(null)}
          />
        )}
        {tab === 'diagnostics' && <DiagnosticsTab diagnostics={diagnostics} />}
      </div>

      {inspect && engine && (
        <InspectDrawer engine={engine} container={inspect} onClose={() => setInspect(null)} />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm ? `Run ${confirm.label || confirm.action}?` : ''}
        description={(confirm?.action === 'prune'
          ? 'This removes all stopped containers, dangling images, and unused networks.'
          : 'This is a destructive action and cannot be undone.')
          + (confirm?.sandbox
            ? " This is the agent's sandbox container — stopping it interrupts sandboxed agent commands."
            : '')}
        confirmLabel={confirm?.action ?? 'Run'}
        variant="destructive"
        onConfirm={() => { if (confirm) void runAction(confirm.action, confirm.target); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
});

// ─── Containers tab ──────────────────────────────────────────────────────────

function pctVal(s?: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace('%', ''));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function ContainersTab({ containers, stats, onAction, onInspect, onOpenShell }: {
  containers: Container[];
  stats: Record<string, ContainerStats>;
  onAction: (a: DockerAction, target: string | null, label: string) => void;
  onInspect: (c: Container) => void;
  onOpenShell: (id: string) => void;
}) {
  if (containers.length === 0) return <Empty icon={Boxes} msg="No containers." />;

  const running = containers.filter((c) => c.state === 'running').length;
  const unhealthy = containers.filter((c) => c.health === 'unhealthy').length;
  const stopped = containers.length - running;
  // Running first, then by name.
  const sorted = [...containers].sort((a, b) => {
    if ((a.state === 'running') !== (b.state === 'running')) return a.state === 'running' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Summary strip */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border flex-shrink-0 text-[11px]">
        <Stat label="running" value={running} tone="green" />
        <Stat label="stopped" value={stopped} tone="muted" />
        {unhealthy > 0 && <Stat label="unhealthy" value={unhealthy} tone="red" />}
        <span className="ml-auto text-muted-foreground">{containers.length} total</span>
      </div>

      {/* Card grid — fills the panel width */}
      <div className="flex-1 min-h-0 overflow-auto p-2">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))' }}>
          {sorted.map((c) => {
            const s = stats[c.name];
            const isRunning = c.state === 'running';
            const cpu = pctVal(s?.cpuPerc);
            const mem = pctVal(s?.memPerc);
            const sandbox = isSandboxContainer(c.name);
            return (
              <div
                key={c.id || c.name}
                className="group rounded-lg border border-border bg-card/40 p-2.5 flex flex-col gap-2 cursor-pointer"
                onClick={() => onInspect(c)}
                title="Click to inspect"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot state={c.state} health={c.health} />
                  <span className="font-medium text-xs truncate" title={c.name}>{c.name || c.id.slice(0, 12)}</span>
                  {sandbox && (
                    <span className="px-1 py-0.5 rounded text-[8px] font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex-shrink-0">
                      agent sandbox
                    </span>
                  )}
                  <StatePill state={c.state} health={c.health} className="ml-auto" />
                </div>
                <div className="text-[10px] font-mono text-muted-foreground truncate" title={c.image}>{c.image || '—'}</div>

                <div className="grid grid-cols-2 gap-2">
                  <Meter icon={Cpu} label="CPU" pct={cpu} value={s?.cpuPerc} active={isRunning} />
                  <Meter icon={MemoryStick} label="Mem" pct={mem} value={s?.memPerc} valueTitle={s?.memUsage} active={isRunning} />
                </div>

                <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[10px] text-muted-foreground font-mono">
                  {isRunning && <span title="net I/O">⇅ {s?.netIO ?? '—'}</span>}
                  {isRunning && c.uptime && <span title="uptime">↑ {c.uptime}</span>}
                  {c.restartCount > 0 && <span className="text-yellow-500/90" title="restarts"><RotateCcw className="w-2.5 h-2.5 inline mr-0.5" />{c.restartCount}</span>}
                  {c.ports && <span className="truncate max-w-[140px]" title={c.ports}>:{c.ports}</span>}
                </div>

                <div
                  className="flex items-center gap-0.5 pt-0.5 border-t border-border/40 opacity-70 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isRunning
                    ? <IconBtn title="Stop" onClick={() => onAction('stop', c.id || c.name, `stop ${c.name}`)}><Square className="w-3 h-3" /></IconBtn>
                    : <IconBtn title="Start" onClick={() => onAction('start', c.id || c.name, `start ${c.name}`)}><Play className="w-3 h-3" /></IconBtn>}
                  <IconBtn title="Restart" onClick={() => onAction('restart', c.id || c.name, `restart ${c.name}`)}><RotateCw className="w-3 h-3" /></IconBtn>
                  <IconBtn title="Remove" onClick={() => onAction('rm', c.id || c.name, `remove ${c.name}`)}><Trash2 className="w-3 h-3" /></IconBtn>
                  {isRunning && (
                    // Prefills the Logs tab's exec box; a real PTY tab in the
                    // TerminalDock is the noted follow-up.
                    <IconBtn title="Run commands in container" onClick={() => onOpenShell(c.id || c.name)}>
                      <SquareTerminal className="w-3 h-3" />
                    </IconBtn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' | 'muted' }) {
  const color = tone === 'green' ? 'text-green-400' : tone === 'red' ? 'text-red-400' : 'text-muted-foreground';
  return (
    <span className="flex items-center gap-1">
      <span className={cn('tabular-nums font-semibold', color)}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Meter({ icon: Icon, label, pct, value, valueTitle, active }: {
  icon: typeof Cpu; label: string; pct: number; value?: string; valueTitle?: string; active: boolean;
}) {
  const barColor = pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-primary';
  return (
    <div className="flex flex-col gap-0.5" title={valueTitle}>
      <div className="flex items-center gap-1 text-[9px] text-muted-foreground uppercase tracking-wide">
        <Icon className="w-2.5 h-2.5" />{label}
        <span className="ml-auto tabular-nums text-foreground/70">{active ? (value ?? '—') : '—'}</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', active ? barColor : 'bg-transparent')} style={{ width: `${active ? pct : 0}%` }} />
      </div>
    </div>
  );
}

function StatusDot({ state, health }: { state: string; health: Container['health'] }) {
  const color = state === 'running'
    ? (health === 'unhealthy' ? 'bg-red-500' : health === 'starting' ? 'bg-yellow-500' : 'bg-green-500')
    : state === 'restarting' ? 'bg-yellow-500'
    : state === 'dead' ? 'bg-red-500'
    : 'bg-muted-foreground/50';
  return <span className={cn('w-2 h-2 rounded-full flex-shrink-0', color, state === 'running' && 'animate-pulse')} />;
}

function StatePill({ state, health, className }: { state: string; health: Container['health']; className?: string }) {
  const color = state === 'running'
    ? (health === 'unhealthy' ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400')
    : state === 'restarting' ? 'bg-yellow-500/15 text-yellow-400'
    : state === 'dead' ? 'bg-red-500/15 text-red-400'
    : 'bg-muted text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0', color, className)}>
      {state}{health ? ` · ${health}` : ''}
    </span>
  );
}

// ─── Services tab (table + dependency graph) ─────────────────────────────────

function ServicesTab({ services }: { services: ComposeService[] }) {
  if (services.length === 0) return <Empty icon={Network} msg="No compose services (no compose file detected)." />;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="max-h-[45%] overflow-auto border-b border-border">
        <table className="w-full text-[11px] font-mono">
          <thead className="sticky top-0 bg-background/95 text-muted-foreground">
            <tr className="text-left">
              <th className="px-3 py-1.5 font-medium">Service</th>
              <th className="px-2 py-1.5 font-medium">Image</th>
              <th className="px-2 py-1.5 font-medium">Depends on</th>
              <th className="px-2 py-1.5 font-medium">Ports</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.name} className="border-t border-border/40">
                <td className="px-3 py-1.5">{s.name}</td>
                <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[160px]">{s.image ?? '—'}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{s.dependsOn.join(', ') || '—'}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{s.ports.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex-1 min-h-0">
        <ServiceGraph services={services} />
      </div>
    </div>
  );
}

// ─── Logs tab (live stream + filter/search/highlight) ────────────────────────

function LogsTab({ engine, cwd, containers, services, hasCompose, logsFlushMs, execRequest, onExecHandled }: {
  engine: NonNullable<RuntimeInfo['engine']>;
  cwd: string;
  containers: Container[];
  services: ComposeService[];
  hasCompose: boolean;
  logsFlushMs: number;
  execRequest: string | null;
  onExecHandled: () => void;
}) {
  const targets = useMemo(() => {
    const svc = services.map((s) => ({ target: s.name, compose: true, label: `svc: ${s.name}` }));
    const con = containers.map((c) => ({ target: c.id || c.name, compose: false, label: c.name }));
    return [...svc, ...con];
  }, [services, containers]);

  const [sel, setSel] = useState<string>('');
  const [search, setSearch] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [cmd, setCmd] = useState('');
  const [execBusy, setExecBusy] = useState(false);
  const linesRef = useRef<string[]>([]);
  const cmdInputRef = useRef<HTMLInputElement>(null);

  // "Open shell" from a container card: select that container and focus the
  // exec input.
  useEffect(() => {
    if (!execRequest) return;
    setSel(`false:${execRequest}`);
    onExecHandled();
    // Focus after the select re-render lands.
    setTimeout(() => cmdInputRef.current?.focus(), 50);
  }, [execRequest, onExecHandled]);

  const chosen = targets.find((t) => `${t.compose}:${t.target}` === sel) ?? targets[0];

  const pushLines = useCallback((extra: string[]) => {
    const arr = linesRef.current;
    arr.push(...extra);
    if (arr.length > MAX_LOG_LINES) arr.splice(0, arr.length - MAX_LOG_LINES);
    setLines([...arr]);
  }, []);

  // Run a one-shot command inside the selected container; output goes into the
  // log view. Compose services aren't container names, so exec targets containers.
  const runExec = useCallback(async () => {
    const command = cmd.trim();
    if (!command || !chosen || chosen.compose || execBusy) return;
    setExecBusy(true);
    pushLines([`$ ${command}`]);
    try {
      const res = await dockerExec(engine, chosen.target, command);
      const body = [res.stdout, res.stderr].filter((x) => x.trim()).join('\n');
      pushLines(body ? body.split('\n') : [`(exit ${res.code ?? '?'})`]);
    } catch (e) {
      pushLines([`error: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setExecBusy(false);
      setCmd('');
    }
  }, [cmd, chosen, engine, execBusy, pushLines]);

  useEffect(() => {
    if (!chosen || !isTauri()) return;
    const id = `runtime-logs-${chosen.compose ? 'svc' : 'con'}-${chosen.target}`;
    linesRef.current = [];
    setLines([]);
    let unlistenData: Unlisten | undefined;
    let unlistenExit: Unlisten | undefined;
    let flush: ReturnType<typeof setInterval> | undefined;
    let disposed = false;

    (async () => {
      unlistenData = await onRuntimeData(id, (line) => {
        const arr = linesRef.current;
        arr.push(line);
        if (arr.length > MAX_LOG_LINES) arr.splice(0, arr.length - MAX_LOG_LINES);
      });
      unlistenExit = await onRuntimeExit(id, () => {});
      if (disposed) return;
      await dockerLogsStream(id, engine, chosen.target, chosen.compose ? cwd : null, chosen.compose).catch(() => {});
      flush = setInterval(() => setLines([...linesRef.current]), logsFlushMs);
    })();

    return () => {
      disposed = true;
      if (flush) clearInterval(flush);
      unlistenData?.();
      unlistenExit?.();
      void dockerKill(id);
    };
  }, [chosen?.target, chosen?.compose, engine, cwd, logsFlushMs]);

  const shown = useMemo(() => {
    return lines.filter((l) => {
      if (errorsOnly && !ERROR_RE.test(l)) return false;
      if (search && !l.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [lines, search, errorsOnly]);

  if (targets.length === 0) return <Empty icon={ScrollText} msg="No containers or services to tail." />;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-shrink-0">
        <select
          className="text-[11px] bg-background border border-border rounded px-1.5 py-0.5 max-w-[180px]"
          value={sel || (chosen ? `${chosen.compose}:${chosen.target}` : '')}
          onChange={(e) => setSel(e.target.value)}
        >
          {targets.map((t) => (
            <option key={`${t.compose}:${t.target}`} value={`${t.compose}:${t.target}`}>{t.label}</option>
          ))}
        </select>
        <input
          className="flex-1 min-w-0 text-[11px] bg-background border border-border rounded px-2 py-0.5"
          placeholder="Filter logs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className={cn('text-[10px] px-1.5 py-0.5 rounded border', errorsOnly ? 'border-red-500/60 text-red-400 bg-red-500/10' : 'border-border text-muted-foreground')}
          onClick={() => setErrorsOnly((v) => !v)}
        >
          Errors
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto bg-black/40 font-mono text-[11px] leading-relaxed p-2">
        {shown.length === 0
          ? <div className="text-muted-foreground">{hasCompose ? 'Waiting for log output…' : 'No output.'}</div>
          : shown.map((l, i) => (
            <div key={i} className={cn('whitespace-pre-wrap break-all', l.startsWith('$ ') && 'text-primary', ERROR_RE.test(l) && 'text-red-400')}>{l}</div>
          ))}
      </div>
      {/* Exec a command in the selected container (containers only, not compose services). */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-t border-border flex-shrink-0 bg-background">
        <span className="text-[11px] font-mono text-muted-foreground">$</span>
        <input
          ref={cmdInputRef}
          className="flex-1 min-w-0 text-[11px] font-mono bg-background border border-border rounded px-2 py-0.5 disabled:opacity-50"
          placeholder={chosen?.compose ? 'Select a container (not a service) to run commands' : `Run in ${chosen?.label ?? '…'} — e.g. ls -la`}
          value={cmd}
          disabled={!chosen || chosen.compose || execBusy}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void runExec(); }}
        />
        <button
          title="Run command (Enter)"
          disabled={!cmd.trim() || !chosen || chosen.compose || execBusy}
          onClick={() => void runExec()}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 disabled:opacity-40 transition-colors"
        >
          <CornerDownLeft className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Diagnostics tab ─────────────────────────────────────────────────────────

function DiagnosticsTab({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) return <Empty icon={AlertTriangle} msg="No issues detected." />;
  return (
    <ul className="divide-y divide-border/40">
      {diagnostics.map((d, i) => (
        <li key={i} className="flex items-start gap-2 px-3 py-2 text-[11px]">
          <AlertTriangle className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0',
            d.severity === 'error' ? 'text-red-400' : d.severity === 'warning' ? 'text-yellow-400' : 'text-muted-foreground')} />
          <div>
            <span>{d.message}</span>
            {d.target && <span className="ml-1 text-muted-foreground font-mono">({d.target})</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Diagnostics computation ─────────────────────────────────────────────────

function computeDiagnostics(services: ComposeService[], containers: Container[]): Diagnostic[] {
  const out: Diagnostic[] = [];

  // Port conflicts: same host port published by >1 service.
  const hostPorts = new Map<string, string[]>();
  for (const s of services) {
    for (const p of s.ports) {
      const host = p.split(':')[0].trim();
      if (!host) continue;
      hostPorts.set(host, [...(hostPorts.get(host) ?? []), s.name]);
    }
  }
  for (const [port, owners] of hostPorts) {
    if (owners.length > 1) {
      out.push({ severity: 'error', message: `Host port ${port} claimed by multiple services: ${owners.join(', ')}`, target: `:${port}` });
    }
  }

  // Depends_on pointing at an undefined service.
  const known = new Set(services.map((s) => s.name));
  for (const s of services) {
    for (const d of s.dependsOn) {
      if (!known.has(d)) out.push({ severity: 'warning', message: `Service "${s.name}" depends on undefined service "${d}"`, target: s.name });
    }
  }

  // Unhealthy / dead containers.
  for (const c of containers) {
    if (c.health === 'unhealthy') out.push({ severity: 'error', message: `Container is unhealthy`, target: c.name });
    if (c.state === 'dead') out.push({ severity: 'error', message: `Container is dead`, target: c.name });
    if (c.state === 'restarting') out.push({ severity: 'warning', message: `Container is restarting`, target: c.name });
  }

  return out;
}

// ─── Small shared UI ─────────────────────────────────────────────────────────

function TabBtn({ active, onClick, icon: Icon, label, badge }: {
  active: boolean; onClick: () => void; icon: typeof Boxes; label: string; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn('flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
    >
      <Icon className="w-3 h-3" />
      <span className="hidden lg:inline">{label}</span>
      {badge ? <span className="ml-0.5 px-1 rounded-full bg-red-500/20 text-red-400 text-[9px]">{badge}</span> : null}
    </button>
  );
}

function IntervalSelect({ label, value, options, onChange }: {
  label: string; value: number; options: [number, string][]; onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 justify-between">
      <span className="text-muted-foreground">{label}</span>
      <select
        className="text-[11px] bg-background border border-border rounded px-1.5 py-0.5"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick}
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors">
      {children}
    </button>
  );
}

function Empty({ icon: Icon, msg, spin }: { icon: typeof Boxes; msg: string; spin?: boolean }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6 text-muted-foreground">
      <Icon className={cn('w-6 h-6 opacity-60', spin && 'animate-spin')} />
      <p className="text-xs max-w-xs">{msg}</p>
    </div>
  );
}
