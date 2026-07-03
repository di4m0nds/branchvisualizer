// ─── External app store ─────────────────────────────────────────────────────
// `useSyncExternalStore`-based replacement for the old monolithic context.
// The old shape — a fresh `{ state, dispatch }` object from a single provider —
// re-rendered every consumer (~40 components, including the commit-graph canvas
// and xterm) on every streamed token (~30×/s). Here components subscribe to
// exactly the slice they select, and `dispatch` is a stable module function.
//
// Selector contract: return an EXISTING state slice or a primitive (compared
// with Object.is). Never construct a new object/array inside a selector — that
// re-renders on every store change and can loop.

import { useSyncExternalStore } from 'react';
import type { AppAction, AppState } from '../types';
import { initialState, reducer } from './reducer';

let state: AppState = initialState;
const listeners = new Set<() => void>();

export function dispatch(action: AppAction): void {
  const next = reducer(state, action);
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Non-reactive read of the freshest state — for event handlers/async flows
 *  that need current data without subscribing the component to it. */
export function getAppState(): AppState {
  return state;
}

/** Subscribe to a slice of app state. Re-renders only when the selected value
 *  changes (Object.is). */
export function useAppSelector<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

/** The stable dispatch function (identity never changes). */
export function useAppDispatch(): typeof dispatch {
  return dispatch;
}

/**
 * Legacy shim, behavior-identical to the old context hook: re-renders on every
 * state change. Fine for cheap/cold components; hot paths should migrate to
 * `useAppSelector`.
 */
export function useAppContext(): { state: AppState; dispatch: typeof dispatch } {
  return { state: useAppSelector((s) => s), dispatch };
}
