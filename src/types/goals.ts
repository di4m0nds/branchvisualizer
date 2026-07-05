// ─── Autonomous goal execution model ─────────────────────────────────────────
// A GoalRun is the executor's durable state: the plan (task list with
// dependencies), per-task outcomes, usage, and an event log. It is persisted
// to disk (goals/<id>.json under the project asset root) after EVERY state
// transition — that file IS the checkpoint that makes resume-after-crash work
// without repeating completed tasks. The chat transcript is just a log.

import type { ModelRef } from '@/types';

export type GoalTaskStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'blocked' | 'skipped';

export interface GoalTask {
  id: string;
  title: string;
  description: string;
  /** Task ids that must be `done` before this one starts. */
  deps: string[];
  status: GoalTaskStatus;
  attempts: number;
  /** Pause for human approval before executing this task. */
  needsApproval?: boolean;
  /** ≤1 KB summary written on completion — the anti-rework memory that later
   *  task prompts (and resumes) are built from. */
  resultSummary?: string;
  /** Optional shell verification. `passed` is set after it runs. */
  verify?: { command?: string; passed?: boolean; note?: string };
}

export type GoalRunStatus =
  | 'planning'
  | 'awaiting_plan_approval'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface GoalEvent {
  ts: string;
  kind: string; // 'plan' | 'task_start' | 'task_done' | 'task_failed' | 'paused' | …
  detail: string;
}

export interface GoalRun {
  id: string;
  projectId: string;
  /** Dedicated session whose transcript logs the run. */
  sessionId: string;
  goal: string;
  /** Model the run was started with — survives restarts so resume doesn't
   *  silently switch to the global default. */
  model?: ModelRef;
  status: GoalRunStatus;
  /** Why the run paused ('cost_limit', 'provider_error: …', 'user', 'app closed'). */
  pauseReason?: string;
  /** Set while awaiting_approval: what the dashboard must approve. */
  pendingApproval?: { taskId: string | null; description: string } | null;
  /** Require plan approval before execution starts. */
  approveGate?: boolean;
  /** ≈USD cap for the whole run; executor pauses at the cap. */
  costLimitUSD?: number | null;
  tasks: GoalTask[];
  usage: { input: number; output: number; costUSD: number };
  events: GoalEvent[];
  createdAt: string;
  updatedAt: string;
}

export const GOAL_EVENTS_CAP = 500;
export const GOAL_SUMMARY_CAP = 1024;
