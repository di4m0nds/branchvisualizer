// ─── Shared provider probing ─────────────────────────────────────────────────
// One implementation for "probe every provider and publish the results",
// previously duplicated across ModelSelect / ModelPicker / ProvidersPanel.
//
// On "idle disconnects": the app holds NO persistent connection to any
// provider — transports are stateless per-request. The reconnect-like delay
// after inactivity is provider-side (CLI cold start, server-side model
// unload). What CAN go stale client-side is the probe status map (the pips,
// and the connected-check `resolveTaskModel` uses for routing fallback), so we
// re-probe when it's old — status never blocks a send.

import { dispatch } from '@/store/store';
import { PROVIDERS } from './index';
import type { ProbeResult } from '../transport';

let lastProbedAt = 0;
let inFlight: Promise<void> | null = null;

/** Probe every provider concurrently and publish results to the store. */
export function probeAllProviders(): Promise<void> {
  // Coalesce concurrent callers (e.g. picker open + window focus) into one run.
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      await Promise.allSettled(PROVIDERS.map(async (p) => {
        const status = await p.probe().catch((e): ProbeResult => ({
          state: 'not_detected',
          tier: 'unknown',
          label: e instanceof Error ? e.message : 'probe failed',
          error: String(e),
        }));
        dispatch({ type: 'SET_PROVIDER_STATUS', providerId: p.id, status });
      }));
      lastProbedAt = Date.now();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Re-probe only when the status map is older than maxAgeMs (default 5 min). */
export function probeIfStale(maxAgeMs = 5 * 60_000): Promise<void> {
  if (Date.now() - lastProbedAt < maxAgeMs) return Promise.resolve();
  return probeAllProviders();
}
