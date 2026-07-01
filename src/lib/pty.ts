// ─── PTY bridge ─────────────────────────────────────────────────────────────
// Thin wrappers over the Rust PTY commands (src-tauri/src/pty.rs) + event
// subscriptions. Output arrives base64-encoded (to preserve byte framing) and is
// decoded to a Uint8Array for xterm.

import { invoke, listen, type Unlisten } from './platform';

export interface SpawnPtyOpts {
  id: string;
  cmd?: string;
  args?: string[];
  cwd: string;
  cols: number;
  rows: number;
}

export function spawnPty(opts: SpawnPtyOpts): Promise<void> {
  return invoke<void>('spawn_pty', {
    id: opts.id,
    cmd: opts.cmd ?? null,
    args: opts.args ?? [],
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
  });
}

export function writePty(id: string, data: string): Promise<void> {
  return invoke<void>('write_pty', { id, data });
}

export function resizePty(id: string, cols: number, rows: number): Promise<void> {
  return invoke<void>('resize_pty', { id, cols, rows });
}

export function killPty(id: string): Promise<void> {
  return invoke<void>('kill_pty', { id });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Subscribe to raw output bytes for one terminal. */
export function onPtyData(id: string, cb: (bytes: Uint8Array) => void): Promise<Unlisten> {
  return listen<string>(`pty://data/${id}`, (b64) => cb(base64ToBytes(b64)));
}

interface ExitPayload {
  id: string;
  code: number | null;
}

/** Subscribe to PTY exit for one terminal (global event, filtered by id). */
export function onPtyExit(id: string, cb: (code: number | null) => void): Promise<Unlisten> {
  return listen<ExitPayload>('pty://exit', (p) => {
    if (p.id === id) cb(p.code);
  });
}
