// ─── Send-to-chat event bus ─────────────────────────────────────────────────
// A tiny per-session bus so panels outside the chat column (e.g. the Plan view)
// can post a follow-up user message into the agent conversation without threading
// callbacks across the 3-zone IDE layout. ChatPanel registers a sender for its
// active session; callers fire `sendToChat(sessionId, text)`. Mirrors the
// open-in-nvim bus pattern.

type Sender = (text: string) => void;

const senders = new Map<string, Sender>();

/** ChatPanel registers how to send for its session; returns an unregister fn. */
export function registerChatSender(sessionId: string, fn: Sender): () => void {
  senders.set(sessionId, fn);
  return () => {
    if (senders.get(sessionId) === fn) senders.delete(sessionId);
  };
}

/** Fire a user message into the given session's chat. No-op if none registered. */
export function sendToChat(sessionId: string, text: string): boolean {
  const fn = senders.get(sessionId);
  if (!fn) return false;
  fn(text);
  return true;
}

// ── Prefill bus ─────────────────────────────────────────────────────────────
// Like the sender, but only fills the composer — never auto-sends. Used by the
// debug/log inspector's "send to agent" so the user reviews before sending.

const prefillers = new Map<string, Sender>();

export function registerChatPrefiller(sessionId: string, fn: Sender): () => void {
  prefillers.set(sessionId, fn);
  return () => {
    if (prefillers.get(sessionId) === fn) prefillers.delete(sessionId);
  };
}

export function prefillChat(sessionId: string, text: string): boolean {
  const fn = prefillers.get(sessionId);
  if (!fn) return false;
  fn(text);
  return true;
}
