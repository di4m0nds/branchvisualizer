// ─── System stats history ────────────────────────────────────────────────────
// Module-level ring buffer of recent SystemSnapshots, fed by the StatusBar's
// existing 2s poll (single producer). SystemPanel and any stats view read the
// history to render trends without adding another interval.

import { useSyncExternalStore } from 'react';
import type { SystemSnapshot } from '@/lib/system';

const MAX_SAMPLES = 120; // ~4 minutes at the 2s poll

let history: SystemSnapshot[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Producer hook-point: StatusBar pushes each polled snapshot here. */
export function pushSystemSnapshot(snap: SystemSnapshot): void {
  history = [...history.slice(-(MAX_SAMPLES - 1)), snap];
  emit();
}

export function getSystemStatsHistory(): SystemSnapshot[] {
  return history;
}

export function useSystemStatsHistory(): SystemSnapshot[] {
  return useSyncExternalStore(subscribe, getSystemStatsHistory, () => history);
}
