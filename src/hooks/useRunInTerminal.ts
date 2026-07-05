// ─── Run-in-terminal event bus ──────────────────────────────────────────────
// A tiny per-session EventTarget mirroring useOpenInNvim: the Commands panel
// asks the session's TerminalDock to open a NEW interactive terminal tab
// running a detected project command (so the user can Ctrl+C it, read a dev
// server's output, etc.) instead of a non-interactive side drawer. Returns
// false when no dock is mounted for the session so the caller can toast.

const buses = new Map<string, EventTarget>();
const subscriberCount = new Map<string, number>();

export interface RunInTerminalDetail {
  /** The shell command line to run. */
  command: string;
  /** Tab title (usually the command's label). */
  title: string;
}

function busFor(sessionId: string): EventTarget {
  let bus = buses.get(sessionId);
  if (!bus) {
    bus = new EventTarget();
    buses.set(sessionId, bus);
  }
  return bus;
}

/** Publish: request a new terminal tab running `command`. Returns false when no
 *  TerminalDock is currently subscribed for the session (nothing would run). */
export function runInTerminal(sessionId: string, detail: RunInTerminalDetail): boolean {
  if ((subscriberCount.get(sessionId) ?? 0) === 0) return false;
  busFor(sessionId).dispatchEvent(new CustomEvent<RunInTerminalDetail>('run-in-terminal', { detail }));
  return true;
}

/** Subscribe: register a listener (the TerminalDock); returns an unsubscribe fn. */
export function subscribeRunInTerminal(
  sessionId: string,
  handler: (detail: RunInTerminalDetail) => void,
): () => void {
  const bus = busFor(sessionId);
  const listener = ((e: Event) => handler((e as CustomEvent<RunInTerminalDetail>).detail)) as EventListener;
  bus.addEventListener('run-in-terminal', listener);
  subscriberCount.set(sessionId, (subscriberCount.get(sessionId) ?? 0) + 1);
  return () => {
    bus.removeEventListener('run-in-terminal', listener);
    subscriberCount.set(sessionId, Math.max(0, (subscriberCount.get(sessionId) ?? 1) - 1));
  };
}
