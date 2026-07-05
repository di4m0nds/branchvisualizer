// ─── Terminal preferences ────────────────────────────────────────────────────
// Which shell new terminal tabs spawn. `defaultShell` is an absolute path (or
// bin name) passed to spawn_pty's `cmd`; absent = platform default resolved in
// Rust ($SHELL on Unix, PowerShell/cmd on Windows). Same load/save pattern as
// costPrefs.

import { invoke, isTauri } from '@/lib/platform';
import { swallow } from '@/lib/log';

const KEY = 'code-agent:terminal_prefs';

export interface TerminalPrefs {
  /** Shell path for new tabs; undefined = system default. */
  defaultShell?: string;
}

export interface ShellInfo {
  id: string;
  label: string;
  path: string;
}

export function loadTerminalPrefs(): TerminalPrefs {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const p = parsed as TerminalPrefs;
    return typeof p.defaultShell === 'string' && p.defaultShell ? { defaultShell: p.defaultShell } : {};
  } catch (e) {
    swallow('terminal', 'load prefs')(e);
    return {};
  }
}

export function saveTerminalPrefs(prefs: TerminalPrefs): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch (e) {
    swallow('terminal', 'persist prefs')(e);
  }
}

/** Shells detected on this machine (Rust-side, existence-checked). */
export async function listShells(): Promise<ShellInfo[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<ShellInfo[]>('list_shells');
  } catch (e) {
    swallow('terminal', 'list shells')(e);
    return [];
  }
}
