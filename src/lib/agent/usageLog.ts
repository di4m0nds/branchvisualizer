// ─── Usage analytics log ─────────────────────────────────────────────────────
// Append-only ring buffer of per-turn token usage, persisted to localStorage.
// Small by construction (capped entries, one record per turn) — this is the
// data source for the Usage settings section, the Monitor dashboard, and the
// cost-limit enforcement in the agent loop.

import { estimateCost } from './pricing';

export type UsageTask = 'main' | 'planning' | 'title' | 'goal';

export interface UsageEntry {
  ts: string; // ISO
  sessionId: string;
  projectId: string;
  providerId: string;
  modelId: string;
  input: number;
  output: number;
  costUSD: number | null;
  task: UsageTask;
}

const KEY = 'code-agent:usage_log';
const MAX_ENTRIES = 2000;

let cache: UsageEntry[] | null = null;

export function loadUsage(): UsageEntry[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    cache = Array.isArray(parsed)
      ? (parsed as UsageEntry[]).filter(
          (e) => e && typeof e.ts === 'string' && typeof e.input === 'number' && typeof e.output === 'number',
        )
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function recordUsage(entry: Omit<UsageEntry, 'costUSD'> & { costUSD?: number | null }): void {
  const cost =
    entry.costUSD !== undefined
      ? entry.costUSD
      : estimateCost({ input: entry.input, output: entry.output, modelId: entry.modelId });
  const next = [...loadUsage(), { ...entry, costUSD: cost }];
  cache = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Quota pressure: halve the buffer and retry once; never throw into the loop.
    cache = cache.slice(Math.floor(cache.length / 2));
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch { /* give up silently — telemetry must never break a turn */ }
  }
}

export interface UsageFilter {
  sessionId?: string;
  projectId?: string;
  task?: UsageTask;
  /** Only entries at/after this ISO timestamp. */
  since?: string;
}

export interface UsageSummary {
  totals: { input: number; output: number; costUSD: number; turns: number };
  byModel: Record<string, { input: number; output: number; costUSD: number; turns: number }>;
  byProject: Record<string, { input: number; output: number; costUSD: number; turns: number }>;
  bySession: Record<string, { input: number; output: number; costUSD: number; turns: number }>;
}

export function summarize(filter: UsageFilter = {}): UsageSummary {
  const empty = () => ({ input: 0, output: 0, costUSD: 0, turns: 0 });
  const sum: UsageSummary = { totals: empty(), byModel: {}, byProject: {}, bySession: {} };
  for (const e of loadUsage()) {
    if (filter.sessionId && e.sessionId !== filter.sessionId) continue;
    if (filter.projectId && e.projectId !== filter.projectId) continue;
    if (filter.task && e.task !== filter.task) continue;
    if (filter.since && e.ts < filter.since) continue;
    for (const bucket of [
      sum.totals,
      (sum.byModel[e.modelId] ??= empty()),
      (sum.byProject[e.projectId] ??= empty()),
      (sum.bySession[e.sessionId] ??= empty()),
    ]) {
      bucket.input += e.input;
      bucket.output += e.output;
      bucket.costUSD += e.costUSD ?? 0;
      bucket.turns += 1;
    }
  }
  return sum;
}

/** ≈ USD spent in a session (cost-limit enforcement). */
export function sessionCostUSD(sessionId: string): number {
  return summarize({ sessionId }).totals.costUSD;
}

/** ≈ USD spent since local midnight (daily cost limit). */
export function todayCostUSD(): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return summarize({ since: midnight.toISOString() }).totals.costUSD;
}

/** Test hook / storage-event hygiene: drop the in-memory cache. */
export function resetUsageCache(): void {
  cache = null;
}
