import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadUsage, recordUsage, resetUsageCache, sessionCostUSD, summarize } from './usageLog';

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
}

beforeEach(() => {
  stubLocalStorage();
  resetUsageCache();
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
  resetUsageCache();
});

function entry(over: Partial<Parameters<typeof recordUsage>[0]> = {}): Parameters<typeof recordUsage>[0] {
  return {
    ts: '2026-07-04T12:00:00Z',
    sessionId: 's1',
    projectId: 'p1',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    input: 1000,
    output: 500,
    task: 'main',
    ...over,
  };
}

describe('usageLog', () => {
  it('records with auto-estimated cost and persists', () => {
    recordUsage(entry());
    const all = loadUsage();
    expect(all).toHaveLength(1);
    // sonnet: $3/M in + $15/M out → 1000/1e6*3 + 500/1e6*15
    expect(all[0].costUSD).toBeCloseTo(0.003 + 0.0075, 6);
    // Survives a cache reset (round-trips through localStorage).
    resetUsageCache();
    expect(loadUsage()).toHaveLength(1);
  });

  it('caps the ring buffer at 2000 entries', () => {
    for (let i = 0; i < 2050; i++) recordUsage(entry({ sessionId: `s${i}` }));
    const all = loadUsage();
    expect(all).toHaveLength(2000);
    expect(all[all.length - 1].sessionId).toBe('s2049');
    expect(all[0].sessionId).toBe('s50');
  });

  it('summarize filters and aggregates', () => {
    recordUsage(entry());
    recordUsage(entry({ sessionId: 's2', task: 'goal', input: 100, output: 50 }));
    recordUsage(entry({ projectId: 'p2', modelId: 'unknown-model-zzz' }));

    const all = summarize();
    expect(all.totals.turns).toBe(3);
    expect(all.totals.input).toBe(2100);
    expect(Object.keys(all.bySession).sort()).toEqual(['s1', 's2']);

    expect(summarize({ task: 'goal' }).totals.turns).toBe(1);
    expect(summarize({ projectId: 'p1' }).totals.turns).toBe(2);
    expect(summarize({ since: '2026-07-05T00:00:00Z' }).totals.turns).toBe(0);

    expect(sessionCostUSD('s1')).toBeGreaterThan(0);
  });

  it('tolerates a corrupt blob', () => {
    localStorage.setItem('code-agent:usage_log', '{not json');
    resetUsageCache();
    expect(loadUsage()).toEqual([]);
    recordUsage(entry());
    expect(loadUsage()).toHaveLength(1);
  });
});
