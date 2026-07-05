// ─── Command-stream bridge ───────────────────────────────────────────────────
// JS side of src-tauri/src/exec.rs: start a jailed project command, subscribe
// to its line stream (stdout/stderr tagged) and exit event. Mirrors the
// runtime.ts listen/cleanup shape.

import { invoke, listen, type Unlisten } from '@/lib/platform';

export interface ExecLine {
  stream: 'out' | 'err';
  line: string;
}

export function execStream(id: string, root: string, command: string): Promise<void> {
  return invoke<void>('exec_stream', { id, root, command });
}

export function execKill(id: string): Promise<void> {
  return invoke<void>('exec_kill', { id });
}

export function onExecData(id: string, handler: (line: ExecLine) => void): Promise<Unlisten> {
  return listen<ExecLine>(`exec://data/${id}`, handler);
}

export function onExecExit(handler: (payload: { id: string; code: number | null }) => void): Promise<Unlisten> {
  return listen<{ id: string; code: number | null }>('exec://exit', handler);
}
