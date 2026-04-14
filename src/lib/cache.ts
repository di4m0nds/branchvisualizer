// ─── localStorage cache with TTL ──────────────────────────────────────────

const CACHE_VERSION = 'bv1';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  version: string;
  data: T;
  expiry: number;
}

function key(namespace: string, id: string): string {
  return `bv:${namespace}:${id}`;
}

export function cacheSet<T>(namespace: string, id: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  try {
    const entry: CacheEntry<T> = {
      version: CACHE_VERSION,
      data,
      expiry: Date.now() + ttlMs,
    };
    localStorage.setItem(key(namespace, id), JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

export function cacheGet<T>(namespace: string, id: string): T | null {
  try {
    const raw = localStorage.getItem(key(namespace, id));
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (entry.version !== CACHE_VERSION) return null;
    if (Date.now() > entry.expiry) {
      localStorage.removeItem(key(namespace, id));
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function cacheClear(namespace?: string): void {
  try {
    const prefix = namespace ? `bv:${namespace}:` : 'bv:';
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

/** Prune all expired entries. Call periodically or on startup. */
export function cachePrune(): void {
  try {
    const now = Date.now();
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('bv:')) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const entry: CacheEntry<unknown> = JSON.parse(raw);
        if (now > entry.expiry) toRemove.push(k);
      } catch {
        toRemove.push(k!);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
