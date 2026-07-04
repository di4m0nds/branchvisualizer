// ─── System status bridge ────────────────────────────────────────────────────
// Thin wrappers over src-tauri/src/system.rs (sysinfo-backed).

import { invoke } from './platform';

export interface DiskInfo {
  mount: string;
  usedBytes: number;
  totalBytes: number;
}

export interface SystemSnapshot {
  cpuPct: number;
  cpuCount: number;
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  loadAvgOne: number;
  uptimeSecs: number;
  disks: DiskInfo[];
  appMem: number;
  appCpuPct: number;
}

export interface ProcInfo {
  pid: number;
  name: string;
  cpuPct: number;
  memBytes: number;
  cmd: string;
  isOwn: boolean;
}

export interface PortInfo {
  port: number;
  pid: number | null;
  process: string | null;
}

export const systemSnapshot = () => invoke<SystemSnapshot>('system_snapshot');
export const systemProcesses = (sort: 'cpu' | 'mem', limit = 30) =>
  invoke<ProcInfo[]>('system_processes', { sort, limit });
export const systemPorts = () => invoke<PortInfo[]>('system_ports');
export const systemKill = (pid: number) => invoke<void>('system_kill', { pid });

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 1 ? 1 : 0)}${u[i]}`;
}
