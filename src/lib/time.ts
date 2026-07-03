// ─── Time formatting ────────────────────────────────────────────────────────
// Shared timestamp formatters so message bubbles and the chat timeline render
// identical times. Inputs are ISO strings (AgentMessage.ts). Invalid input
// degrades to an empty string rather than "Invalid Date".

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Short clock time for inline display, e.g. "14:02". */
export function formatTime(iso: string): string {
  const d = parse(iso);
  if (!d) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Compact elapsed duration, e.g. "820ms", "6.4s", "1m 24s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}m ${s}s`;
}

/** Full locale date+time for tooltips, e.g. "Jul 2, 2026, 14:02:37". */
export function formatFull(iso: string): string {
  const d = parse(iso);
  if (!d) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}
