import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyHistoryWindow, DEFAULT_COST_PREFS, loadCostPrefs, saveCostPrefs } from './costPrefs';
import { estimateCost, estimateTotalCost, formatCost, priceFor } from './pricing';
import { loadRouting, resolveTaskModel, saveRouting } from './modelRouting';
import type { ProbeResult } from './transport';

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
}

beforeEach(stubLocalStorage);
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

const CONNECTED: ProbeResult = { state: 'connected', tier: 'paid', label: 'ok' };
const DETECTED: ProbeResult = { state: 'detected', tier: 'unknown', label: 'no key' };

describe('costPrefs', () => {
  it('defaults + spread-merge round trip', () => {
    expect(loadCostPrefs()).toEqual(DEFAULT_COST_PREFS);
    saveCostPrefs({ ...DEFAULT_COST_PREFS, historyWindow: 10 });
    expect(loadCostPrefs().historyWindow).toBe(10);
    expect(loadCostPrefs().toolResultCap).toBe(DEFAULT_COST_PREFS.toolResultCap);
  });

  it('applyHistoryWindow keeps the last N (0 = all)', () => {
    const msgs = [1, 2, 3, 4, 5];
    expect(applyHistoryWindow(msgs, 0)).toEqual(msgs);
    expect(applyHistoryWindow(msgs, 2)).toEqual([4, 5]);
    expect(applyHistoryWindow(msgs, 99)).toEqual(msgs);
  });
});

describe('pricing', () => {
  it('exact model, family fallback, and unknown', () => {
    expect(priceFor('claude-haiku-4-5')).toEqual({ inPerM: 1, outPerM: 5 });
    expect(priceFor('claude-haiku-4-5-20251001')).toEqual({ inPerM: 1, outPerM: 5 }); // family
    expect(priceFor('totally-unknown-model')).toBeNull();
  });

  it('estimateCost math and modelId precedence', () => {
    // 1M in + 1M out on haiku = $1 + $5.
    expect(estimateCost({ input: 1e6, output: 1e6, modelId: 'haiku' })).toBeCloseTo(6);
    // fallback model applies when the usage has none
    expect(estimateCost({ input: 1e6, output: 0 }, 'sonnet')).toBeCloseTo(3);
    expect(estimateCost({ input: 1, output: 1 })).toBeNull();
  });

  it('estimateTotalCost skips unpriceable entries; null only when none priced', () => {
    const total = estimateTotalCost([
      { input: 1e6, output: 0, modelId: 'haiku' },
      { input: 1e6, output: 0, modelId: 'unknown-x' },
    ]);
    expect(total).toBeCloseTo(1);
    expect(estimateTotalCost([{ input: 1, output: 1, modelId: 'unknown-x' }])).toBeNull();
  });

  it('formatCost floors tiny values', () => {
    expect(formatCost(0.001)).toBe('<$0.01');
    expect(formatCost(1.234)).toBe('$1.23');
  });
});

describe('modelRouting', () => {
  const session = { providerId: 'anthropic', modelId: 'claude-sonnet-5', context: 'standard' as const };

  it('defaults to the session model when unrouted', () => {
    const r = resolveTaskModel('title', session, { anthropic: CONNECTED });
    expect(r.model).toEqual(session);
    expect(r.routed).toBe(false);
  });

  it('applies the route when its provider is connected', () => {
    saveRouting({ title: { providerId: 'gemini', modelId: 'gemini-2.5-flash-lite', context: 'standard' } });
    const r = resolveTaskModel('title', session, { gemini: CONNECTED });
    expect(r.routed).toBe(true);
    expect(r.model.modelId).toBe('gemini-2.5-flash-lite');
  });

  it('falls back seamlessly when the routed provider is not connected', () => {
    saveRouting({ title: { providerId: 'gemini', modelId: 'gemini-2.5-flash-lite', context: 'standard' } });
    const cases: Record<string, ProbeResult>[] = [{}, { gemini: DETECTED }];
    for (const status of cases) {
      const r = resolveTaskModel('title', session, status);
      expect(r.routed).toBe(false);
      expect(r.model).toEqual(session);
    }
  });

  it('routing map persists', () => {
    saveRouting({ planning: 'session' });
    expect(loadRouting()).toEqual({ planning: 'session' });
  });
});
