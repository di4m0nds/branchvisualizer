// ─── Open-in-nvim event bus ────────────────────────────────────────────────
// A tiny per-session EventTarget so tabs (Files/Docs/…) can request that a
// file open in the session's nvim terminal without threading callbacks through
// the tab tree. The `TerminalDock` subscribes and either sends `:e <path>\r`
// to an existing nvim PTY or spawns one with the file already loaded.

const buses = new Map<string, EventTarget>();

export interface OpenInNvimDetail { path: string }

function busFor(sessionId: string): EventTarget {
  let bus = buses.get(sessionId);
  if (!bus) {
    bus = new EventTarget();
    buses.set(sessionId, bus);
  }
  return bus;
}

/** Publish: request the given file open in the session's nvim terminal. */
export function openInNvim(sessionId: string, path: string): void {
  busFor(sessionId).dispatchEvent(new CustomEvent<OpenInNvimDetail>('open-in-nvim', { detail: { path } }));
}

/** Subscribe: register a listener; returns an unsubscribe fn. */
export function subscribeOpenInNvim(
  sessionId: string,
  handler: (detail: OpenInNvimDetail) => void,
): () => void {
  const bus = busFor(sessionId);
  const listener = ((e: Event) => handler((e as CustomEvent<OpenInNvimDetail>).detail)) as EventListener;
  bus.addEventListener('open-in-nvim', listener);
  return () => bus.removeEventListener('open-in-nvim', listener);
}

// ── Path-level convenience ──────────────────────────────────────────────────
// Open any file mention in the ACTIVE session's nvim (used by FileLink, ref
// chips, and @-token highlights). Only works for local sessions with a cwd.

import { getAppState } from '@/store/store';
import { toast } from '@/services/toast';

export function openPathInNvim(path: string): boolean {
  const { activeSessionId, sessions } = getAppState();
  const session = sessions.find((s) => s.id === activeSessionId);
  if (!session || session.repoSource !== 'local' || !session.cwd) return false;
  // Absolute paths under the session root become root-relative for `:e`.
  const rel = path.startsWith(session.cwd)
    ? path.slice(session.cwd.length).replace(/^[/\\]/, '')
    : path;
  openInNvim(session.id, rel);
  toast.info(`Opening ${rel.split(/[/\\]/).pop()} in nvim…`);
  return true;
}
