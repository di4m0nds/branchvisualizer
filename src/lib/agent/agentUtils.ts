// ─── Pure agent-loop helpers ─────────────────────────────────────────────────
// Small, dependency-free utilities used by the agent loop. Kept separate from
// `loop.ts` (which pulls in the provider SDKs) so they can be unit-tested in a
// plain node environment.

/** Cap for a tool_result payload sent back to the model (see truncateForModel). */
export const MODEL_TOOL_RESULT_CAP = 24000;

// Cap the tool_result payload sent back to the model. A large `read_file` or
// `run_command` dump would otherwise grow context (and cost) without bound. We
// keep the head and tail — the informative ends of most output — and elide the
// middle.
export function truncateForModel(content: string, limit = MODEL_TOOL_RESULT_CAP): string {
  if (content.length <= limit) return content;
  const head = Math.floor(limit * 0.7);
  const tail = limit - head;
  const elided = content.length - head - tail;
  return `${content.slice(0, head)}\n\n…[${elided} chars elided]…\n\n${content.slice(-tail)}`;
}

/** Whether an error is an abort (Stop button) — never retried. */
export function isAbortError(e: unknown): boolean {
  return (e instanceof DOMException && e.name === 'AbortError')
    || (e instanceof Error && e.name === 'AbortError');
}

/** Whether a failed model call is a transient error worth retrying (429/5xx/network). */
export function isRetryableError(e: unknown): boolean {
  if (isAbortError(e)) return false;
  const status = (e as { status?: number })?.status;
  if (typeof status === 'number' && (status === 429 || (status >= 500 && status < 600))) return true;
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /network|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|timeout|overloaded/i.test(msg);
}
