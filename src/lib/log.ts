// ─── Structured app logging ──────────────────────────────────────────────────
// Every swallowed error in the app must at least pass through here so failures
// leave a trace. A ring buffer keeps the recent history available for a future
// in-app debug panel; console mirroring is DEV-only for debug/info but always
// on for warn/error. Framework-agnostic: safe in the browser build and in
// vitest's node environment (no Tauri imports).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  scope: string;
  msg: string;
  data?: unknown;
}

const RING_SIZE = 500;
const ring: LogEntry[] = [];

const DEV = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

function push(level: LogLevel, scope: string, msg: string, data?: unknown): void {
  ring.push({ ts: Date.now(), level, scope, msg, data });
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);

  if (level === 'warn' || level === 'error' || DEV) {
    const line = `[${scope}] ${msg}`;
    if (level === 'error') console.error(line, data ?? '');
    else if (level === 'warn') console.warn(line, data ?? '');
    else console.log(line, data ?? '');
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export const log = {
  debug(scope: string, msg: string, data?: unknown): void {
    push('debug', scope, msg, data);
  },
  info(scope: string, msg: string, data?: unknown): void {
    push('info', scope, msg, data);
  },
  warn(scope: string, msg: string, data?: unknown): void {
    push('warn', scope, msg, data);
  },
  error(scope: string, err: unknown, msg?: string): void {
    push('error', scope, msg ? `${msg}: ${describeError(err)}` : describeError(err), err);
  },
};

/**
 * For catch blocks that intentionally continue (quota errors, best-effort
 * cleanup, transient probes). Records the swallowed error at debug level so
 * "silent" failures still leave a trace:
 *
 *   somePromise.catch(swallow('pty', 'kill on unmount'));
 *   try { … } catch (e) { swallow('prefs')(e); }
 */
export function swallow(scope: string, note?: string): (e: unknown) => void {
  return (e: unknown) => {
    push('debug', scope, note ? `swallowed (${note}): ${describeError(e)}` : `swallowed: ${describeError(e)}`, e);
  };
}

/** Recent log entries (newest last) for debugging / a future debug panel. */
export function recentLogs(): LogEntry[] {
  return ring.slice();
}
