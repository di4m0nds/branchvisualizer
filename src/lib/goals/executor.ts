// ─── Goal executor ───────────────────────────────────────────────────────────
// Frontend orchestrator for one autonomous goal run: plans (one planning turn
// producing a <goal_plan> task list), then drives runAgentTurn once per ready
// task with a COMPACT driver prompt built from GoalRun state — goal + current
// task + completed-task summaries — never a transcript replay. That is what
// makes resume cheap and rework-free: completed tasks are skipped by
// construction, and the checkpoint (goals/<id>.json) is written after every
// transition.
//
// Honest scope: the executor lives in the app process. Closing the app pauses
// the run at its last checkpoint; on next launch the Monitor offers Resume.

import type { Dispatch } from 'react';
import type { AppAction, ModelRef } from '@/types';
import type { GoalRun, GoalTask } from '@/types/goals';
import type { AgentMessage, Project, Session } from '@/types/session';
import { createDefaultContext, nextId } from '@/types/session';
import { getAppState } from '@/store/store';
import { runAgentTurn, type PendingAction } from '@/lib/agent/loop';
import { createTransportFor } from '@/lib/agent/providers';
import { resolveTaskModel, type TaskType } from '@/lib/agent/modelRouting';
import { executeTool } from '@/lib/agent/tools';
import { renderPrompt } from '@/lib/agent/prompts';
import { loadCostPrefs } from '@/lib/agent/costPrefs';
import { registerActiveTurn } from '@/lib/agent/activeTurns';
import { summarize } from '@/lib/agent/usageLog';
import { fallbackSummary, parseGoalPlan, parseTaskResult } from './parse';
import { appendEvent, saveRun } from './goalStore';

const TASK_MAX_ATTEMPTS = 2;      // driver turns per task before failed
const VERIFY_FIX_ROUNDS = 1;      // fix turns per failing verify command
const PLAN_RETRIES = 2;           // corrective planning retries (3 attempts total)

// Live executors, keyed by goal id — the dashboard resolves approvals and
// pause/cancel through this map; a missing entry means "resume from disk".
export const activeExecutors = new Map<string, GoalExecutor>();

export class GoalExecutor {
  private abort: AbortController | null = null;
  private approvalResolver: ((ok: boolean) => void) | null = null;
  private stopped = false;

  constructor(
    public run: GoalRun,
    private project: Project,
    private dispatch: Dispatch<AppAction>,
  ) {
    activeExecutors.set(run.id, this);
  }

  // ── public control surface (dashboard) ────────────────────────────────────

  async start(): Promise<void> {
    try {
      if (this.run.tasks.length === 0) {
        await this.plan();
        if (this.run.status !== 'running' && this.run.status !== 'awaiting_plan_approval') return;
        if (this.run.status === 'awaiting_plan_approval') return; // resumes via approvePlan()
      }
      await this.runLoop();
    } catch (e) {
      await this.pauseWith(`provider_error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (!['paused', 'awaiting_plan_approval', 'awaiting_approval'].includes(this.run.status)) {
        activeExecutors.delete(this.run.id);
      }
    }
  }

  async approvePlan(): Promise<void> {
    if (this.run.status !== 'awaiting_plan_approval') return;
    await this.patch({ status: 'running' }, 'plan_approved', 'Plan approved by user.');
    try {
      await this.runLoop();
    } catch (e) {
      await this.pauseWith(`provider_error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  resolveApproval(ok: boolean): void {
    this.approvalResolver?.(ok);
  }

  async pause(): Promise<void> {
    this.stopped = true;
    this.abort?.abort();
    await this.pauseWith('user');
  }

  async cancel(): Promise<void> {
    this.stopped = true;
    this.abort?.abort();
    this.approvalResolver?.(false);
    await this.patch({ status: 'cancelled', pendingApproval: null }, 'cancelled', 'Cancelled by user.');
    activeExecutors.delete(this.run.id);
  }

  // ── phases ────────────────────────────────────────────────────────────────

  private async plan(): Promise<void> {
    await this.patch({ status: 'planning' }, 'plan', 'Planning started.');
    let tasks: GoalTask[] = [];
    // Up to PLAN_RETRIES corrective attempts. Each turn brackets itself with
    // plan_turn_start/plan_turn_done events so the Goals tab's feed moves even
    // while a long planning turn is in flight.
    for (let attempt = 0; attempt <= PLAN_RETRIES; attempt++) {
      const first = attempt === 0;
      const label = first ? 'Goal planning request' : `Goal planning retry ${attempt}/${PLAN_RETRIES}`;
      await this.appendEventAndSave('plan_turn_start', first ? 'Planning the goal…' : `Re-planning (attempt ${attempt + 1}/${PLAN_RETRIES + 1}).`);
      const text = await this.turn(
        renderPrompt(first ? 'goal_plan' : 'goal_plan_retry', { goal: this.run.goal }),
        'planning',
        { kind: first ? 'goal_plan' : 'goal_retry', label },
      );
      if (this.stopped) return;
      tasks = parseGoalPlan(text);
      await this.appendEventAndSave('plan_turn_done', tasks.length > 0
        ? `Parsed ${tasks.length} tasks.`
        : `No parseable plan (attempt ${attempt + 1}).`);
      if (tasks.length > 0) break;
      if (attempt < PLAN_RETRIES) {
        const head = text.replace(/\s+/g, ' ').trim().slice(0, 200);
        await this.appendEventAndSave('plan_retry', `No parseable plan — retrying. Reply head: ${head || '(empty)'}`);
      }
    }
    if (tasks.length === 0) {
      await this.patch(
        { status: 'failed', pauseReason: `no parseable plan after ${PLAN_RETRIES + 1} attempts` },
        'plan_failed',
        `Model produced no parseable plan after ${PLAN_RETRIES + 1} attempts.`,
      );
      return;
    }
    const next = this.run.approveGate ? 'awaiting_plan_approval' as const : 'running' as const;
    await this.patch({ tasks, status: next }, 'plan_ready', `${tasks.length} tasks planned.`);
  }

  private async runLoop(): Promise<void> {
    await this.patch({ status: 'running', pauseReason: undefined }, 'run', 'Execution loop entered.');
    for (;;) {
      if (this.stopped) return;

      const done = new Set(this.run.tasks.filter((t) => t.status === 'done' || t.status === 'skipped').map((t) => t.id));
      const next = this.run.tasks.find((t) => t.status === 'pending' && t.deps.every((d) => done.has(d)));

      if (!next) {
        // No runnable task: anything still pending is blocked by a failure.
        const tasks = this.run.tasks.map((t) =>
          t.status === 'pending' ? { ...t, status: 'blocked' as const } : t);
        const allDone = tasks.every((t) => t.status === 'done' || t.status === 'skipped');
        await this.patch(
          { tasks, status: allDone ? 'completed' : 'failed', pendingApproval: null },
          allDone ? 'completed' : 'ended_incomplete',
          allDone ? 'All tasks completed.' : 'Run ended with failed/blocked tasks.',
        );
        return;
      }

      // Cost gate (per-goal cap, falling back to the global session cap).
      const cap = this.run.costLimitUSD ?? loadCostPrefs().sessionCostLimitUSD;
      if (cap != null && this.currentUsage().costUSD >= cap) {
        await this.pauseWith('cost_limit');
        return;
      }

      // Optional human gate for flagged tasks.
      if (next.needsApproval) {
        const ok = await this.waitForApproval(next);
        if (this.stopped) return;
        if (!ok) {
          await this.updateTask(next.id, { status: 'skipped', resultSummary: 'Skipped: approval denied.' }, 'task_skipped', `${next.id} skipped (approval denied).`);
          continue;
        }
      }

      await this.executeTask(next);
      if (this.stopped) return;
      if (this.run.status !== 'running') return; // paused mid-task
    }
  }

  private async executeTask(task: GoalTask): Promise<void> {
    await this.updateTask(task.id, { status: 'in_progress', attempts: task.attempts + 1 }, 'task_start', `${task.id}: ${task.title}`);

    const completed = this.run.tasks
      .filter((t) => t.status === 'done' && t.resultSummary)
      .map((t) => `- [${t.id}] ${t.title}: ${t.resultSummary}`)
      .join('\n') || '(nothing yet)';

    const text = await this.turn(renderPrompt('goal_task_driver', {
      goal: this.run.goal,
      completed,
      task_id: task.id,
      task_title: task.title,
      task_description: task.description,
    }), 'main', { kind: 'goal_task', label: `Task ${task.id}: ${task.title}` });
    if (this.stopped) return;

    const result = parseTaskResult(text) ?? { status: 'done' as const, summary: fallbackSummary(text) };

    if (result.status !== 'done') {
      const current = this.run.tasks.find((t) => t.id === task.id)!;
      if (result.status === 'failed' && current.attempts < TASK_MAX_ATTEMPTS) {
        // One more driver turn — the model sees its own failure summary.
        await this.updateTask(task.id, { status: 'pending', resultSummary: `Previous attempt failed: ${result.summary}` }, 'task_retry', `${task.id} retrying: ${result.summary}`);
        return;
      }
      await this.updateTask(task.id, { status: result.status, resultSummary: result.summary }, `task_${result.status}`, `${task.id}: ${result.summary}`);
      return;
    }

    // Verification: run the command; on failure give the model fix rounds.
    const verified = await this.verify(task, result.summary);
    if (this.stopped) return;
    if (verified) {
      await this.updateTask(task.id, { status: 'done', resultSummary: result.summary }, 'task_done', `${task.id}: ${result.summary}`);
    }
  }

  /** Returns true when the task counts as done (no verify, or verify passed). */
  private async verify(task: GoalTask, summary: string): Promise<boolean> {
    const command = task.verify?.command;
    if (!command) return true;
    const session = this.session();
    for (let round = 0; ; round++) {
      let output = '';
      try {
        output = await executeTool('run_command', { command }, {
          root: session?.cwd ?? this.project.path,
          sandbox: session?.context.sandbox,
          project: this.project,
        });
      } catch (e) {
        output = e instanceof Error ? e.message : String(e);
      }
      const exitZero = /\[exit 0\]\s*$/.test(output);
      if (exitZero) {
        await this.updateTask(task.id, { verify: { command, passed: true } }, 'verify_ok', `${task.id}: verify passed.`);
        return true;
      }
      if (round >= VERIFY_FIX_ROUNDS) {
        await this.updateTask(
          task.id,
          { status: 'failed', resultSummary: `${summary} — verification failed: ${command}`, verify: { command, passed: false, note: output.slice(-500) } },
          'verify_failed',
          `${task.id}: verify failed after fixes.`,
        );
        return false;
      }
      await this.appendEventAndSave('verify_retry', `${task.id}: verify failed, asking for a fix.`);
      const fixText = await this.turn(
        renderPrompt('goal_verify_fix', { command, output: output.slice(-4000) }),
        'main',
        { kind: 'goal_verify_fix', label: `Fix verify: ${task.id}` },
      );
      if (this.stopped) return false;
      const fixResult = parseTaskResult(fixText);
      if (fixResult && fixResult.status !== 'done') {
        await this.updateTask(task.id, { status: fixResult.status, resultSummary: fixResult.summary, verify: { command, passed: false } }, `task_${fixResult.status}`, `${task.id}: ${fixResult.summary}`);
        return false;
      }
    }
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private session(): Session | null {
    return getAppState().sessions.find((s) => s.id === this.run.sessionId) ?? null;
  }

  /** One model turn on the goal session; returns the assistant text it produced.
   *  `driver` tags the user message so the chat renders a compact goal chip
   *  instead of dumping the full internal prompt as a bubble. */
  private async turn(text: string, kind: TaskType = 'main', driver?: AgentMessage['driver']): Promise<string> {
    const session = this.session();
    if (!session) throw new Error('goal session missing');
    // Same resolution as chat turns: session model, then task routing on top —
    // so goals honor the model picked when the goal was launched.
    const sessionModel = session.modelConfig?.model ?? getAppState().currentModel;
    const { model } = resolveTaskModel(kind, sessionModel, getAppState().providerStatus);
    const transport = await createTransportFor(model.providerId, model.modelId, model.context);
    const before = session.messages.length;
    this.abort = new AbortController();
    const unregister = registerActiveTurn({
      sessionId: session.id,
      projectId: this.project.id,
      title: session.title,
      startedAt: Date.now(),
      source: 'goal',
      stop: () => this.abort?.abort(),
    });
    try {
      await runAgentTurn(session, text, {
        transport,
        dispatch: this.dispatch,
        project: this.project,
        requestApproval: (p) => this.toolApproval(p),
        signal: this.abort.signal,
      }, new Date().toISOString(), { usageTask: 'goal', driver });
    } finally {
      unregister();
      this.abort = null;
    }
    // Refresh cost telemetry on every turn (checkpointed with the run).
    this.run = { ...this.run, usage: this.currentUsage() };
    // Join ALL assistant text this turn appended — a plan or task_result
    // emitted mid-tool-loop must not be shadowed by a later closing remark.
    const after = this.session();
    return (after?.messages ?? [])
      .slice(before)
      .filter((m) => m.role === 'assistant' && m.text.trim().length > 0)
      .map((m) => m.text)
      .join('\n\n');
  }

  private currentUsage(): GoalRun['usage'] {
    const t = summarize({ sessionId: this.run.sessionId }).totals;
    return { input: t.input, output: t.output, costUSD: t.costUSD };
  }

  /** Tool-level approval surfaced on the dashboard (ChatPanel not required). */
  private toolApproval(p: PendingAction): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.approvalResolver = (ok) => {
        this.approvalResolver = null;
        void this.patch({ status: 'running', pendingApproval: null }, ok ? 'tool_approved' : 'tool_denied', p.description);
        resolve(ok);
      };
      void this.patch(
        { status: 'awaiting_approval', pendingApproval: { taskId: null, description: p.description } },
        'tool_approval_needed',
        p.description,
      );
    });
  }

  /** Task-level gate (`needsApproval`). */
  private waitForApproval(task: GoalTask): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.approvalResolver = (ok) => {
        this.approvalResolver = null;
        void this.patch({ status: 'running', pendingApproval: null }, ok ? 'task_approved' : 'task_denied', `${task.id}: ${task.title}`);
        resolve(ok);
      };
      void this.patch(
        { status: 'awaiting_approval', pendingApproval: { taskId: task.id, description: `Run task ${task.id}: ${task.title}` } },
        'task_approval_needed',
        `${task.id}: ${task.title}`,
      );
    });
  }

  private async pauseWith(reason: string): Promise<void> {
    if (['completed', 'failed', 'cancelled'].includes(this.run.status)) return;
    await this.patch({ status: 'paused', pauseReason: reason, pendingApproval: null }, 'paused', reason);
  }

  private async patch(patch: Partial<GoalRun>, eventKind: string, detail: string): Promise<void> {
    this.run = appendEvent({ ...this.run, ...patch, usage: this.currentUsage() }, eventKind, detail);
    await saveRun(this.project, this.run);
  }

  private async updateTask(taskId: string, patch: Partial<GoalTask>, eventKind: string, detail: string): Promise<void> {
    const tasks = this.run.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t));
    await this.patch({ tasks }, eventKind, detail);
  }

  private async appendEventAndSave(kind: string, detail: string): Promise<void> {
    this.run = appendEvent(this.run, kind, detail);
    await saveRun(this.project, this.run);
  }
}

// ─── Entry points ────────────────────────────────────────────────────────────

// One active executor per project (asset-write safety); further goals queue.
const projectQueues = new Map<string, Promise<void>>();

function enqueue(projectId: string, job: () => Promise<void>): void {
  const tail = projectQueues.get(projectId) ?? Promise.resolve();
  projectQueues.set(projectId, tail.then(job, job));
}

/** Test hook: drop the per-project serialization queues so an independent test
 *  isn't chained behind a previous test's (already-settled) goal job. */
export function resetProjectQueues(): void {
  projectQueues.clear();
}

/** Create the dedicated goal session + run and queue it for execution. */
export function startGoal(
  project: Project,
  goalText: string,
  dispatch: Dispatch<AppAction>,
  opts?: { approveGate?: boolean; costLimitUSD?: number | null; model?: ModelRef },
): GoalRun {
  const goalId = nextId('goal');
  // The launching session's model (when given) wins over the global default,
  // so switching models in the chat chrome carries over to the goal run.
  const model: ModelRef = { ...(opts?.model ?? getAppState().currentModel) };
  const session: Session = {
    id: nextId('session'),
    title: `Goal: ${goalText.slice(0, 40)}${goalText.length > 40 ? '…' : ''}`,
    projectId: project.id,
    repoSource: project.source,
    repoRef: project.path,
    cwd: project.source === 'local' ? project.path : null,
    modelConfig: { model },
    // Autonomous work needs auto-accepted file edits; commands still surface
    // as dashboard approvals, and pinned rules remain absolute.
    context: { ...createDefaultContext(), accessLevel: 'auto_accept' },
    messages: [],
    terminals: [],
    goalId,
  };
  dispatch({ type: 'CREATE_SESSION', session });

  const now = new Date().toISOString();
  const run: GoalRun = {
    id: goalId,
    projectId: project.id,
    sessionId: session.id,
    goal: goalText,
    model,
    status: 'planning',
    approveGate: opts?.approveGate ?? true,
    costLimitUSD: opts?.costLimitUSD ?? null,
    pendingApproval: null,
    tasks: [],
    usage: { input: 0, output: 0, costUSD: 0 },
    events: [],
    createdAt: now,
    updatedAt: now,
  };
  const executor = new GoalExecutor(run, project, dispatch);
  enqueue(project.id, () => executor.start());
  return run;
}

/** Resume a run loaded from disk (after a pause or an app restart). */
export function resumeGoal(project: Project, run: GoalRun, dispatch: Dispatch<AppAction>): void {
  const existing = activeExecutors.get(run.id);
  if (existing) {
    if (run.status === 'awaiting_plan_approval') void existing.approvePlan();
    else enqueue(project.id, () => existing.start());
    return;
  }
  // The goal session may have been closed; recreate a minimal one if needed.
  if (!getAppState().sessions.some((s) => s.id === run.sessionId)) {
    const session: Session = {
      id: run.sessionId,
      title: `Goal: ${run.goal.slice(0, 40)}`,
      projectId: project.id,
      repoSource: project.source,
      repoRef: project.path,
      cwd: project.source === 'local' ? project.path : null,
      // Prefer the model the run was started with (persisted on the run).
      modelConfig: { model: { ...(run.model ?? getAppState().currentModel) } },
      context: { ...createDefaultContext(), accessLevel: 'auto_accept' },
      messages: [],
      terminals: [],
      goalId: run.id,
    };
    dispatch({ type: 'CREATE_SESSION', session });
  }
  const executor = new GoalExecutor(run, project, dispatch);
  enqueue(project.id, () => executor.start());
}
