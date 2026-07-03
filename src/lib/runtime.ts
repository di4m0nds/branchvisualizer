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

export function runtimeDetect(cwd: string): Promise<RuntimeInfo> {
  return invoke<RuntimeInfo>('runtime_detect', { cwd });
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

/** Parse one `docker stats --format json` line into a ContainerStats (or null). */
export function parseStatsLine(line: string): ContainerStats | null {
  const t = line.trim();
  if (!t) return null;
  try {
    const v = JSON.parse(t) as Record<string, unknown>;
    const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
    const name = s('Name') || s('Container') || s('name');
    if (!name) return null;
    return {
      name,
      cpuPerc: s('CPUPerc') || s('cpuPerc'),
      memUsage: s('MemUsage') || s('memUsage'),
      memPerc: s('MemPerc') || s('memPerc'),
      netIO: s('NetIO') || s('netIO'),
      blockIO: s('BlockIO') || s('blockIO'),
      pids: s('PIDs') || s('pids'),
    };
  } catch {
    return null;
  }
}
