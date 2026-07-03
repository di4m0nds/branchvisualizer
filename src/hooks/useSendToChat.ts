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
