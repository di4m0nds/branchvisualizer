// ─── Per-task model routing ──────────────────────────────────────────────────
// Route cheap tasks to cheap models. The user maps task types to a
// provider/model pair in Settings → Models & Cost; resolution SEAMLESSLY falls
// back to the session's model whenever the routed provider isn't connected —
// nothing breaks when a key is missing, routing just doesn't apply.

import type { ModelRef } from '@/types';
import type { ContextSizeId, ProbeResult } from './transport';
import { swallow } from '../log';

const KEY = 'code-agent:model_routing';

export type TaskType = 'main' | 'planning' | 'title';

export const TASK_LABELS: Record<TaskType, { label: string; description: string }> = {
  main: { label: 'Main conversation', description: 'Regular chat turns (direct build mode).' },
  planning: { label: 'Planning turns', description: 'Turns while the session is in planning mode — plan quality matters, but a mid-tier model is often enough.' },
  title: { label: 'Session titles', description: 'One-line titles derived from the first message. Perfect for the cheapest model; falls back to the local heuristic.' },
};

/** 'session' = follow the session's chosen model (default for every task). */
export type TaskRoute = ModelRef | 'session';
export type ModelRouting = Partial<Record<TaskType, TaskRoute>>;

export function loadRouting(): ModelRouting {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as ModelRouting) : {};
  } catch (e) {
    swallow('routing', 'load')(e);
    return {};
  }
}

export function saveRouting(routing: ModelRouting): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(routing));
  } catch (e) {
    swallow('routing', 'persist')(e);
  }
}

/** Is the route's provider actually usable right now? */
function providerUsable(providerId: string, status: Record<string, ProbeResult>): boolean {
  return status[providerId]?.state === 'connected';
}

export interface ResolvedRoute {
  model: ModelRef;
  /** True when the task's configured route was applied (vs session fallback). */
  routed: boolean;
}

/**
 * Resolve which model serves a task. Order: configured route (if its provider
 * is connected) → session model. Never throws; always returns a usable ref.
 */
export function resolveTaskModel(
  task: TaskType,
  sessionModel: ModelRef,
  providerStatus: Record<string, ProbeResult>,
  routing: ModelRouting = loadRouting(),
): ResolvedRoute {
  const route = routing[task];
  if (route && route !== 'session' && providerUsable(route.providerId, providerStatus)) {
    return { model: route, routed: true };
  }
  return { model: sessionModel, routed: false };
}

/** Convenience for settings UI: normalized context for a routed ref. */
export function routeContext(route: TaskRoute | undefined): ContextSizeId {
  return route && route !== 'session' && route.context === '1m' ? '1m' : 'standard';
}
