// ─── Active-turn registry (runtime-only) ─────────────────────────────────────
// Live view of which sessions currently have a model turn in flight, with a
// Stop handle. Module-level external store (same pattern as usePanelFocus) so
// the Monitor panel can list running turns without the app reducer being
// involved — this state is transient by nature and must never persist.

import { useSyncExternalStore } from 'react';

export interface ActiveTurn {
  sessionId: string;
  projectId: string;
  /** Session title snapshot at turn start (display only). */
  title: string;
  startedAt: number; // epoch ms
  /** 'goal' when driven by the goal executor. */
  source: 'chat' | 'goal';
  stop: () => void;
}

let turns: ActiveTurn[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Register a turn; returns the unregister function (call in finally). */
export function registerActiveTurn(turn: ActiveTurn): () => void {
  turns = [...turns, turn];
  emit();
  return () => {
    turns = turns.filter((t) => t !== turn);
    emit();
  };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getActiveTurns(): ActiveTurn[] {
  return turns;
}

export function useActiveTurns(): ActiveTurn[] {
  return useSyncExternalStore(subscribe, getActiveTurns);
}
