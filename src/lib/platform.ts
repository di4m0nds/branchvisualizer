// ─── Platform seam ─────────────────────────────────────────────────────────
// Every Rust-backed capability (git bridge, PTY, fs tools, API-key fetch) is
// reached through this module. In the Tauri desktop shell it dispatches to
// `@tauri-apps/api`; in a plain browser (`pnpm dev` at :5173) the desktop-only
// calls throw a typed `DesktopOnlyError` so callers can degrade to placeholders
// instead of crashing. This is what keeps the web build green at every milestone.

/**
 * Thrown by `invoke`/`listen` when a desktop-only capability is used in a plain
 * browser context. Callers should catch this and render a graceful placeholder
 * (e.g. a "requires the desktop app" toast) rather than let it propagate.
 */
export class DesktopOnlyError extends Error {
  constructor(feature: string) {
    super(`${feature} requires the desktop app (Tauri). It is unavailable in the browser.`);
    this.name = 'DesktopOnlyError';
  }
}

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Invoke a Tauri command. Throws `DesktopOnlyError` in a browser context so the
 * caller can degrade gracefully. The Tauri API is imported dynamically so the
 * web bundle never hard-depends on it.
 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new DesktopOnlyError(`Command "${cmd}"`);
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

/** An unlisten function returned by `listen`. Call it to stop receiving events. */
export type Unlisten = () => void;

/**
 * Subscribe to a Tauri event. Returns a no-op unlisten in the browser (after
 * signalling desktop-only via the console) so component cleanup stays simple.
 */
export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<Unlisten> {
  if (!isTauri()) {
    // No events in the browser — return a no-op unlisten so callers don't crash.
    return () => {};
  }
  const { listen: tauriListen } = await import('@tauri-apps/api/event');
  const unlisten = await tauriListen<T>(event, (e) => handler(e.payload));
  return unlisten;
}
