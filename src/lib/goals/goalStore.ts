// ─── Goal-run store ──────────────────────────────────────────────────────────
// Durable state for autonomous goal runs. Every run is checkpointed to disk
// (goals/<id>.json under the project asset root) after each state transition;
// localStorage holds only lightweight pointers (`code-agent:active_goals`) so
// boot knows which files to offer for resume. In-memory: a module external
// store the Monitor dashboard subscribes to.

import { useSyncExternalStore } from 'react';
import type { GoalEvent, GoalRun } from '@/types/goals';
import { GOAL_EVENTS_CAP } from '@/types/goals';
import type { Project } from '@/types/session';
import { getProjectStore } from '@/lib/projectStore';
import { swallow } from '@/lib/log';

const ACTIVE_KEY = 'code-agent:active_goals';

/** Statuses that keep a run in the boot-resume pointer list. */
const LIVE_STATUSES = new Set(['planning', 'awaiting_plan_approval', 'running', 'awaiting_approval', 'paused']);

// ─── In-memory store ─────────────────────────────────────────────────────────

let runs: GoalRun[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getGoalRuns(): GoalRun[] {
  return runs;
}

export function getGoalRun(goalId: string): GoalRun | null {
  return runs.find((r) => r.id === goalId) ?? null;
}

export function useGoalRuns(): GoalRun[] {
  return useSyncExternalStore(subscribe, getGoalRuns, () => runs);
}

/** Replace/insert a run in memory (persistence is separate — see saveRun). */
export function upsertRun(run: GoalRun): void {
  const exists = runs.some((r) => r.id === run.id);
  runs = exists ? runs.map((r) => (r.id === run.id ? run : r)) : [run, ...runs];
  emit();
}

// ─── Active-goal pointers (localStorage) ─────────────────────────────────────

interface ActivePointer { goalId: string; projectId: string }

function readPointers(): ActivePointer[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? (parsed as ActivePointer[]).filter((p) => p && typeof p.goalId === 'string' && typeof p.projectId === 'string')
      : [];
  } catch (e) {
    swallow('goals', 'read active pointers')(e);
    return [];
  }
}

function writePointers(ptrs: ActivePointer[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(ptrs));
  } catch (e) {
    swallow('goals', 'persist active pointers')(e);
  }
}

// ─── Disk persistence ────────────────────────────────────────────────────────

/** Persist a run to disk + update memory and the boot pointers. This is THE
 *  checkpoint — call after every state transition. */
export async function saveRun(project: Project, run: GoalRun): Promise<void> {
  const stamped: GoalRun = { ...run, updatedAt: new Date().toISOString() };
  upsertRun(stamped);
  const ptrs = readPointers().filter((p) => p.goalId !== run.id);
  if (LIVE_STATUSES.has(stamped.status)) ptrs.push({ goalId: run.id, projectId: run.projectId });
  writePointers(ptrs);
  try {
    await getProjectStore(project).write(`goals/${run.id}.json`, JSON.stringify(stamped, null, 2));
  } catch (e) {
    swallow('goals', `persist run ${run.id}`)(e);
  }
}

/** Permanently remove a run: memory, boot pointer, and the on-disk checkpoint.
 *  Intended for terminal runs (completed / cancelled / failed). */
export async function removeRun(project: Project, goalId: string): Promise<void> {
  runs = runs.filter((r) => r.id !== goalId);
  emit();
  writePointers(readPointers().filter((p) => p.goalId !== goalId));
  try {
    await getProjectStore(project).remove(`goals/${goalId}.json`);
  } catch (e) {
    swallow('goals', `delete run ${goalId}`)(e);
  }
}

export function appendEvent(run: GoalRun, kind: string, detail: string): GoalRun {
  const events: GoalEvent[] = [...run.events, { ts: new Date().toISOString(), kind, detail }];
  return { ...run, events: events.slice(-GOAL_EVENTS_CAP) };
}

/** Load every persisted run for a project into memory (index the goals/ dir). */
export async function loadProjectRuns(project: Project): Promise<GoalRun[]> {
  try {
    const store = getProjectStore(project);
    const files = (await store.list('goals')).filter((e) => !e.isDir && e.name.endsWith('.json'));
    const loaded: GoalRun[] = [];
    for (const f of files) {
      const raw = await store.read(f.path).catch(() => null);
      if (!raw) continue;
      try {
        const run = JSON.parse(raw) as GoalRun;
        if (!run || typeof run.id !== 'string' || !Array.isArray(run.tasks)) continue;
        // A run persisted as running/planning/awaiting_approval died with the
        // app (its in-process executor is gone) — surface as paused so the
        // dashboard offers Resume instead of showing a zombie. awaiting_plan_
        // approval is intentionally left as-is (no executor needed to approve).
        if (run.status === 'running' || run.status === 'planning' || run.status === 'awaiting_approval') {
          run.status = 'paused';
          run.pauseReason = 'interrupted — app restarted';
          run.pendingApproval = null;
          run.tasks = run.tasks.map((t) => (t.status === 'in_progress' ? { ...t, status: 'pending' } : t));
          run.events = appendEvent(run, 'interrupted', 'Run interrupted by an app restart — resume to continue.').events;
          void saveRun(project, run);
        }
        loaded.push(run);
        upsertRun(run);
      } catch { /* skip corrupt file */ }
    }
    return loaded;
  } catch {
    return [];
  }
}

/** Boot hook: load runs for every project referenced by an active pointer. */
export async function bootLoadActiveRuns(projects: Project[]): Promise<void> {
  const ptrs = readPointers();
  const projectIds = [...new Set(ptrs.map((p) => p.projectId))];
  for (const pid of projectIds) {
    const project = projects.find((p) => p.id === pid);
    if (project) await loadProjectRuns(project);
  }
  // Prune pointers whose runs finished or vanished.
  const liveIds = new Set(runs.filter((r) => LIVE_STATUSES.has(r.status)).map((r) => r.id));
  writePointers(readPointers().filter((p) => liveIds.has(p.goalId)));
}

/** Test hook. */
export function resetGoalStore(): void {
  runs = [];
  emit();
}
