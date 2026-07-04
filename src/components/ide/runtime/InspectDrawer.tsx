import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { runtimeInspect } from '@/lib/runtime';
import type { Container, ContainerEngine } from '@/types/runtime';

// ─── Container inspect drawer ────────────────────────────────────────────────
// Right-side overlay (inside RuntimePanel's relative wrapper) showing the
// debugging-relevant slice of `<engine> inspect`: env, mounts, ports, restart
// policy, image, cmd/entrypoint, state. Parses both engines' JSON defensively.

interface Parsed {
  env: string[];
  mounts: { source: string; destination: string; rw: boolean | null }[];
  ports: string[];
  restartPolicy: string;
  image: string;
  cmd: string;
  entrypoint: string;
  state: { status: string; startedAt: string; exitCode: number | null };
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function joinCmd(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(' ');
  return asStr(v);
}

function parseInspect(raw: string): Parsed {
  const parsed = JSON.parse(raw) as unknown;
  const v = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown> ?? {};
  const config = (v.Config ?? {}) as Record<string, unknown>;
  const hostConfig = (v.HostConfig ?? {}) as Record<string, unknown>;
  const state = (v.State ?? {}) as Record<string, unknown>;
  const netSettings = (v.NetworkSettings ?? {}) as Record<string, unknown>;

  const portsObj = (netSettings.Ports ?? hostConfig.PortBindings ?? {}) as Record<string, unknown>;
  const ports = Object.entries(portsObj).map(([containerPort, bindings]) => {
    const b = asArray(bindings)[0] as Record<string, unknown> | undefined;
    const host = b ? `${asStr(b.HostIp) || '0.0.0.0'}:${asStr(b.HostPort)}` : '';
    return host ? `${host} → ${containerPort}` : containerPort;
  });

  const restart = (hostConfig.RestartPolicy ?? {}) as Record<string, unknown>;
  const restartPolicy = asStr(restart.Name)
    ? `${asStr(restart.Name)}${Number(restart.MaximumRetryCount) > 0 ? ` (max ${restart.MaximumRetryCount})` : ''}`
    : '';

  return {
    env: asArray(config.Env).map(String),
    mounts: asArray(v.Mounts).map((m) => {
      const mm = m as Record<string, unknown>;
      return {
        source: asStr(mm.Source),
        destination: asStr(mm.Destination),
        rw: typeof mm.RW === 'boolean' ? mm.RW : null,
      };
    }),
    ports,
    restartPolicy,
    image: asStr(config.Image) || asStr(v.ImageName) || asStr(v.Image),
    cmd: joinCmd(config.Cmd),
    entrypoint: joinCmd(config.Entrypoint),
    state: {
      status: asStr(state.Status),
      startedAt: asStr(state.StartedAt),
      exitCode: typeof state.ExitCode === 'number' ? state.ExitCode : null,
    },
  };
}

export default function InspectDrawer({ engine, container, onClose }: {
  engine: ContainerEngine;
  container: Container;
  onClose: () => void;
}) {
  const [data, setData] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    runtimeInspect(engine, container.id || container.name)
      .then((raw) => { if (!cancelled) setData(parseInspect(raw)); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [engine, container.id, container.name]);

  return (
    <div className="absolute inset-y-0 right-0 w-[340px] max-w-[85%] border-l border-border bg-background z-10 flex flex-col shadow-xl">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border flex-shrink-0">
        <span className="text-[11px] font-mono font-medium truncate" title={container.name}>{container.name}</span>
        <button onClick={onClose} title="Close" className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3 text-[11px]">
        {error && <p className="text-red-400">{error}</p>}
        {!data && !error && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> inspecting…
          </div>
        )}
        {data && (
          <>
            <Row label="State">
              <span className={cn(data.state.status === 'running' ? 'text-green-400' : 'text-muted-foreground')}>
                {data.state.status || '—'}
              </span>
              {data.state.exitCode !== null && data.state.status !== 'running' && (
                <span className="ml-2 text-muted-foreground">exit {data.state.exitCode}</span>
              )}
              {data.state.startedAt && <div className="text-muted-foreground/70 font-mono text-[10px]">{data.state.startedAt}</div>}
            </Row>
            {data.image && <Row label="Image"><span className="font-mono break-all">{data.image}</span></Row>}
            {(data.entrypoint || data.cmd) && (
              <Row label="Command">
                {data.entrypoint && <div className="font-mono break-all text-muted-foreground">entrypoint: {data.entrypoint}</div>}
                {data.cmd && <div className="font-mono break-all">{data.cmd}</div>}
              </Row>
            )}
            {data.restartPolicy && <Row label="Restart policy"><span className="font-mono">{data.restartPolicy}</span></Row>}
            {data.ports.length > 0 && (
              <Row label={`Ports (${data.ports.length})`}>
                {data.ports.map((p, i) => <div key={i} className="font-mono">{p}</div>)}
              </Row>
            )}
            {data.mounts.length > 0 && (
              <Row label={`Mounts (${data.mounts.length})`}>
                {data.mounts.map((m, i) => (
                  <div key={i} className="font-mono break-all text-[10px]">
                    {m.source} → {m.destination}
                    {m.rw === false && <span className="text-amber-500 ml-1">ro</span>}
                  </div>
                ))}
              </Row>
            )}
            {data.env.length > 0 && (
              <Row label={`Env (${data.env.length})`}>
                {data.env.map((e, i) => <div key={i} className="font-mono break-all text-[10px] text-muted-foreground">{e}</div>)}
              </Row>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">{label}</div>
      {children}
    </div>
  );
}
