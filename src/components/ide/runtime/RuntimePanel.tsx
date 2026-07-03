import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Play, Square, RotateCw, Trash2, Download, Hammer,
  Boxes, ScrollText, Network, AlertTriangle, ArrowUpCircle, ArrowDownCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/platform';
import { useActiveSession } from '@/hooks/useActiveSession';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ServiceGraph from './ServiceGraph';
import {
  runtimeDetect, dockerPs, dockerComposeServices, dockerAction, dockerKill,
  dockerStatsStream, dockerLogsStream, onRuntimeData, onRuntimeExit, parseStatsLine,
  type DockerAction,
} from '@/lib/runtime';
import type {
  RuntimeInfo, Container, ComposeService, ContainerStats, Diagnostic,
} from '@/types/runtime';
import type { Unlisten } from '@/lib/platform';

type Tab = 'containers' | 'services' | 'logs' | 'diagnostics';
const DESTRUCTIVE: ReadonlySet<DockerAction> = new Set(['prune', 'rm', 'down']);
const MAX_LOG_LINES = 2000;
const ERROR_RE = /\b(err(or)?|fatal|panic|exception|fail(ed|ure)?)\b/i;

export default function RuntimePanel() {
  const active = useActiveSession();
  const cwd = active?.repoSource === 'local' ? active.cwd : null;

  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [tab, setTab] = useState<Tab>('containers');
  const [containers, setContainers] = useState<Container[]>([]);
  const [services, setServices] = useState<ComposeService[]>([]);
  const [stats, setStats] = useState<Record<string, ContainerStats>>({});
  const [confirm, setConfirm] = useState<{ action: DockerAction; target: string | null; label: string } | null>(null);

  // ── Detection (on project change) ─────────────────────────────────────
  useEffect(() => {
    if (!isTauri() || !cwd) { setInfo(null); return; }
    let cancelled = false;
    setDetecting(true);
    runtimeDetect(cwd)
      .then((i) => { if (!cancelled) setInfo(i); })
      .catch(() => { if (!cancelled) setInfo(null); })
      .finally(() => { if (!cancelled) setDetecting(false); });
    return () => { cancelled = true; };
  }, [cwd]);

  const engine = info?.engine ?? null;

  // ── Load containers + services (poll ps every 3s) ─────────────────────
  const refresh = useCallback(async () => {
    if (!engine) return;
    try {
      const [ps, comp] = await Promise.allSettled([
        dockerPs(engine),
        cwd && info?.composeFile ? dockerComposeServices(engine, cwd) : Promise.resolve({ services: [] }),
      ]);
      if (ps.status === 'fulfilled') setContainers(ps.value);
      if (comp.status === 'fulfilled') setServices(comp.value.services);
    } catch { /* transient */ }
  }, [engine, cwd, info?.composeFile]);

  useEffect(() => {
    if (!engine) { setContainers([]); setServices([]); return; }
    void refresh();
    const iv = setInterval(() => void refresh(), 3000);
    return () => clearInterval(iv);
  }, [engine, refresh]);

  // ── Live stats stream (while on Containers tab) ───────────────────────
  const statsRef = useRef<Record<string, ContainerStats>>({});
  useEffect(() => {
    if (!engine || tab !== 'containers' || !isTauri()) return;
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
      flush = setInterval(() => setStats({ ...statsRef.current }), 700);
    })();

    return () => {
      disposed = true;
      if (flush) clearInterval(flush);
      unlistenData?.();
      unlistenExit?.();
      void dockerKill(id);
    };
  }, [engine, tab]);

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
    if (DESTRUCTIVE.has(action)) setConfirm({ action, target, label });
    else void runAction(action, target);
  }, [runAction]);

  // ── Guards / empty states ─────────────────────────────────────────────
  if (!isTauri()) return <Empty icon={Boxes} msg="Runtime panel is available in the desktop app." />;
  if (!active || active.repoSource !== 'local' || !cwd) {
    return <Empty icon={Boxes} msg="Open a local project to inspect its container runtime." />;
  }
  if (detecting && !info) return <Empty icon={RefreshCw} msg="Detecting container runtime…" spin />;
  if (!engine) {
    return <Empty icon={Boxes} msg="No Docker or Podman found on PATH. Install one to use this panel." />;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header: engine + tabs + refresh */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border flex-shrink-0">
        <span className="text-[11px] font-mono text-muted-foreground truncate" title={info?.version ?? ''}>
          {engine}{info?.composeFile ? ` · ${info.composeFile}` : ''}
        </span>
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
          <IconBtn title="Refresh" onClick={() => void refresh()}><RefreshCw className="w-3.5 h-3.5" /></IconBtn>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'containers' && <ContainersTab containers={containers} stats={stats} onAction={requestAction} />}
        {tab === 'services' && <ServicesTab services={services} />}
        {tab === 'logs' && <LogsTab engine={engine} cwd={cwd} containers={containers} services={services} hasCompose={!!info?.composeFile} />}
        {tab === 'diagnostics' && <DiagnosticsTab diagnostics={diagnostics} />}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm ? `Run ${confirm.label || confirm.action}?` : ''}
        description={confirm?.action === 'prune'
          ? 'This removes all stopped containers, dangling images, and unused networks.'
          : 'This is a destructive action and cannot be undone.'}
        confirmLabel={confirm?.action ?? 'Run'}
        variant="destructive"
        onConfirm={() => { if (confirm) void runAction(confirm.action, confirm.target); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

// ─── Containers tab ──────────────────────────────────────────────────────────

function ContainersTab({ containers, stats, onAction }: {
  containers: Container[];
  stats: Record<string, ContainerStats>;
  onAction: (a: DockerAction, target: string | null, label: string) => void;
}) {
  if (containers.length === 0) return <Empty icon={Boxes} msg="No containers." />;
  return (
    <table className="w-full text-[11px] font-mono">
      <thead className="sticky top-0 bg-background/95 text-muted-foreground">
        <tr className="text-left">
          <th className="px-3 py-1.5 font-medium">Name</th>
          <th className="px-2 py-1.5 font-medium">State</th>
          <th className="px-2 py-1.5 font-medium">CPU</th>
          <th className="px-2 py-1.5 font-medium">Mem</th>
          <th className="px-2 py-1.5 font-medium">Net I/O</th>
          <th className="px-2 py-1.5 font-medium">Uptime</th>
          <th className="px-2 py-1.5 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {containers.map((c) => {
          const s = stats[c.name];
          const running = c.state === 'running';
          return (
            <tr key={c.id || c.name} className="border-t border-border/40 hover:bg-accent/20">
              <td className="px-3 py-1.5 truncate max-w-[180px]" title={`${c.name} · ${c.image}`}>{c.name}</td>
              <td className="px-2 py-1.5"><StateBadge state={c.state} health={c.health} /></td>
              <td className="px-2 py-1.5 tabular-nums">{s?.cpuPerc ?? '—'}</td>
              <td className="px-2 py-1.5 tabular-nums" title={s?.memUsage}>{s?.memPerc ?? '—'}</td>
              <td className="px-2 py-1.5 tabular-nums">{s?.netIO ?? '—'}</td>
              <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[120px]">{c.uptime || '—'}</td>
              <td className="px-2 py-1.5">
                <div className="flex items-center justify-end gap-0.5">
                  {running
                    ? <IconBtn title="Stop" onClick={() => onAction('stop', c.id || c.name, `stop ${c.name}`)}><Square className="w-3 h-3" /></IconBtn>
                    : <IconBtn title="Start" onClick={() => onAction('start', c.id || c.name, `start ${c.name}`)}><Play className="w-3 h-3" /></IconBtn>}
                  <IconBtn title="Restart" onClick={() => onAction('restart', c.id || c.name, `restart ${c.name}`)}><RotateCw className="w-3 h-3" /></IconBtn>
                  <IconBtn title="Remove" onClick={() => onAction('rm', c.id || c.name, `remove ${c.name}`)}><Trash2 className="w-3 h-3" /></IconBtn>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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

function LogsTab({ engine, cwd, containers, services, hasCompose }: {
  engine: NonNullable<RuntimeInfo['engine']>;
  cwd: string;
  containers: Container[];
  services: ComposeService[];
  hasCompose: boolean;
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
  const linesRef = useRef<string[]>([]);

  const chosen = targets.find((t) => `${t.compose}:${t.target}` === sel) ?? targets[0];

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
      flush = setInterval(() => setLines([...linesRef.current]), 400);
    })();

    return () => {
      disposed = true;
      if (flush) clearInterval(flush);
      unlistenData?.();
      unlistenExit?.();
      void dockerKill(id);
    };
  }, [chosen?.target, chosen?.compose, engine, cwd]);

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
            <div key={i} className={cn('whitespace-pre-wrap break-all', ERROR_RE.test(l) && 'text-red-400')}>{l}</div>
          ))}
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

function StateBadge({ state, health }: { state: string; health: Container['health'] }) {
  const color = state === 'running'
    ? (health === 'unhealthy' ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400')
    : state === 'restarting' ? 'bg-yellow-500/15 text-yellow-400'
    : state === 'dead' ? 'bg-red-500/15 text-red-400'
    : 'bg-muted text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]', color)}>
      {state}{health ? ` · ${health}` : ''}
    </span>
  );
}

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
