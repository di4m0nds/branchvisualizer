// ─── Container runtime bridge ────────────────────────────────────────────────
// Thin wrappers over the Rust docker/podman commands (src-tauri/src/docker.rs)
// plus event subscriptions. Live stats/logs arrive on `runtime://data/<id>` (one
// JSON stats row or log line per emit); a global `runtime://exit` fires when a
// stream ends. Mirrors the PTY bridge shape (src/lib/pty.ts) so streaming output
// bypasses React state.

import { invoke, listen, type Unlisten } from './platform';
import type {
  CommandResult, ComposeConfig, Container, ContainerEngine, ContainerStats, RuntimeInfo,
} from '@/types/runtime';

export function runtimeDetect(cwd: string, preferred?: ContainerEngine | null): Promise<RuntimeInfo> {
  return invoke<RuntimeInfo>('runtime_detect', { cwd, preferred: preferred ?? null });
}

/** Raw `inspect` JSON (array) for one container; caller parses defensively. */
export function runtimeInspect(bin: ContainerEngine, target: string): Promise<string> {
  return invoke<string>('docker_inspect', { bin, target });
}

export function dockerPs(bin: ContainerEngine): Promise<Container[]> {
  return invoke<Container[]>('docker_ps', { bin });
}

export function dockerComposeServices(bin: ContainerEngine, cwd: string): Promise<ComposeConfig> {
  return invoke<ComposeConfig>('docker_compose_services', { bin, cwd });
}

export function dockerStatsStream(id: string, bin: ContainerEngine): Promise<void> {
  return invoke<void>('docker_stats_stream', { id, bin });
}

export function dockerLogsStream(
  id: string, bin: ContainerEngine, target: string, cwd: string | null, compose: boolean,
): Promise<void> {
  return invoke<void>('docker_logs_stream', { id, bin, target, cwd, compose });
}

export function dockerKill(id: string): Promise<void> {
  return invoke<void>('docker_kill', { id });
}

export type DockerAction = 'start' | 'stop' | 'restart' | 'rm' | 'pull' | 'build' | 'prune' | 'up' | 'down';

export function dockerAction(
  bin: ContainerEngine, action: DockerAction, target: string | null, cwd: string | null,
): Promise<CommandResult> {
  return invoke<CommandResult>('docker_action', { bin, action, target, cwd });
}

/** Run a one-shot command inside a container and capture its output. */
export function dockerExec(bin: ContainerEngine, target: string, command: string): Promise<CommandResult> {
  return invoke<CommandResult>('docker_exec', { bin, target, command });
}

/** Subscribe to one stream's output lines (stats rows or log lines). */
export function onRuntimeData(id: string, cb: (line: string) => void): Promise<Unlisten> {
  return listen<string>(`runtime://data/${id}`, (line) => cb(line));
}

interface ExitPayload {
  id: string;
  code: number | null;
}

/** Subscribe to a stream's exit (global event, filtered by id). */
export function onRuntimeExit(id: string, cb: (code: number | null) => void): Promise<Unlisten> {
  return listen<ExitPayload>('runtime://exit', (p) => {
    if (p.id === id) cb(p.code);
  });
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

/**
 * Parse one stats line into a ContainerStats. Handles BOTH engines:
 * docker emits pre-formatted strings (`CPUPerc: "0.27%"`, `MemUsage: "1.4MiB / …"`,
 * `NetIO: "1kB / 0B"`); podman emits numbers (`CPU: 0.27`, `MemUsage: 1482752`
 * bytes, `Network: { iface: { RxBytes, TxBytes } }`).
 */
export function parseStatsLine(line: string): ContainerStats | null {
  const t = line.trim();
  if (!t) return null;
  try {
    const v = JSON.parse(t) as Record<string, unknown>;
    const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
    const num = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : NaN);

    const name = str('Name') || str('Container') || str('name');
    if (!name) return null;

    // CPU / Mem %: docker string, else podman number (already a percentage).
    const cpuPerc = str('CPUPerc') || (Number.isNaN(num('CPU')) ? '' : fmtPct(num('CPU')));
    const memPerc = str('MemPerc') || (Number.isNaN(num('MemPerc')) ? '' : fmtPct(num('MemPerc')));

    // Mem usage: docker string, else podman bytes number.
    const memUsage = str('MemUsage') || (Number.isNaN(num('MemUsage')) ? '' : fmtBytes(num('MemUsage')));

    // Net I/O: docker string, else sum podman per-interface Rx/Tx.
    let netIO = str('NetIO');
    if (!netIO && v.Network && typeof v.Network === 'object') {
      let rx = 0; let tx = 0;
      for (const iface of Object.values(v.Network as Record<string, { RxBytes?: number; TxBytes?: number }>)) {
        rx += iface?.RxBytes ?? 0;
        tx += iface?.TxBytes ?? 0;
      }
      netIO = `${fmtBytes(rx)} / ${fmtBytes(tx)}`;
    }

    // Block I/O: docker string, else podman BlockInput/BlockOutput bytes.
    let blockIO = str('BlockIO');
    if (!blockIO && (typeof v.BlockInput === 'number' || typeof v.BlockOutput === 'number')) {
      blockIO = `${fmtBytes(num('BlockInput') || 0)} / ${fmtBytes(num('BlockOutput') || 0)}`;
    }

    const pids = str('PIDs') || (Number.isNaN(num('PIDs')) ? '' : String(num('PIDs')));

    return { name, cpuPerc, memUsage, memPerc, netIO, blockIO, pids };
  } catch {
    return null;
  }
}
