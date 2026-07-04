// ─── Container runtime types ─────────────────────────────────────────────────
// Mirror the serde (camelCase) shapes emitted by src-tauri/src/docker.rs.

export type ContainerEngine = 'docker' | 'podman';

export interface EngineProbe {
  name: ContainerEngine;
  version: string | null;
  /** Daemon/service reachable (`<bin> info` succeeded) — `--version` alone lies. */
  alive: boolean;
}

export interface RuntimeInfo {
  /** Every installed engine with liveness — feeds the header switcher. */
  engines: EngineProbe[];
  /** Backend-chosen default; null when neither engine is on PATH. */
  engine: ContainerEngine | null;
  version: string | null;
  composeFile: string | null;
  hasDockerfile: boolean;
  composeCommand: string | null;
}

export type ContainerState =
  | 'running' | 'exited' | 'created' | 'paused' | 'restarting' | 'dead' | string;

export type ContainerHealth = 'healthy' | 'unhealthy' | 'starting';

export interface Container {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  status: string;
  health: ContainerHealth | null;
  ports: string;
  uptime: string;
  restartCount: number;
}

export interface ComposeService {
  name: string;
  dependsOn: string[];
  image: string | null;
  ports: string[];
}

export interface ComposeConfig {
  services: ComposeService[];
}

/** Live per-container resource stats, parsed from `docker stats --format json`. */
export interface ContainerStats {
  name: string;
  cpuPerc: string;
  memUsage: string;
  memPerc: string;
  netIO: string;
  blockIO: string;
  pids: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  target?: string;
}
