// ─── Repository visit history (localStorage) ──────────────────────────────

export interface HistoryEntry {
  label: string;      // "owner/repo"
  fullUrl: string;    // "https://github.com/owner/repo"
  visitedAt: number;  // timestamp ms
}

const STORAGE_KEY = 'bv_repo_history';
const MAX_ENTRIES  = 10;

export function getHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export function addToHistory(label: string, fullUrl: string): void {
  const history = getHistory().filter(e => e.label !== label);
  history.unshift({ label, fullUrl, visitedAt: Date.now() });
  if (history.length > MAX_ENTRIES) history.splice(MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // quota exceeded or unavailable — ignore
  }
}

export function removeFromHistory(label: string): void {
  const history = getHistory().filter(e => e.label !== label);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // quota exceeded or unavailable — ignore
  }
}

/** Human-readable relative time, e.g. "3h ago", "2d ago" */
export function timeAgoShort(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
