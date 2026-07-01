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
