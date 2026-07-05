import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRequest, NeutralResponse } from '@/lib/agent/transport';

// Scripted transport: each model call shifts the next canned response and
// records the request so tests can assert what the executor actually sent.
const script: Array<string | (() => string)> = [];
const seenRequests: AgentRequest[] = [];

vi.mock('@/lib/agent/providers', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/agent/providers')>();
  return {
    ...original,
    createTransportFor: async () => ({
      id: 'mock',
      modelId: 'mock-model',
      createMessage: async (
        req: AgentRequest,
        cbs: { onText?: (d: string) => void },
      ): Promise<NeutralResponse> => {
        seenRequests.push(req);
        const next = script.shift();
        const text = typeof next === 'function' ? next() : next ?? '<task_result status="done" summary="ok"/>';
        // Stream like a real provider — the loop renders only streamed deltas.
        cbs.onText?.(text);
        return {
          content: [{ type: 'text', text }],
          stopReason: 'end_turn',
          usage: { inputTokens: 100, outputTokens: 50, total: 150 },
          providerModel: 'mock-model',
        };
      },
    }),
  };
});

import { startGoal, activeExecutors, resetProjectQueues } from './executor';
import { getGoalRun, resetGoalStore } from './goalStore';
import { resetUsageCache } from '@/lib/agent/usageLog';
import { dispatch, getAppState } from '@/store/store';
import type { Project } from '@/types/session';

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
}

const project: Project = { id: 'p_goal', name: 'x', path: '/tmp/x', source: 'local', createdAt: '2026-01-01' };

async function waitFor(cond: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const PLAN = `<goal_plan>[
  {"id":"t1","title":"First","description":"do first"},
  {"id":"t2","title":"Second","description":"do second","deps":["t1"]}
]</goal_plan>`;

beforeEach(() => {
  stubLocalStorage();
  resetGoalStore();
  resetProjectQueues();
  resetUsageCache();
  script.length = 0;
  seenRequests.length = 0;
});
afterEach(async () => {
  // Some tests (e.g. the synchronous "seeds the goal session" check) start a
  // run without awaiting its terminal state, leaving an executor running in the
  // background. Left alone it would keep pulling from the shared `script`,
  // stealing responses meant for the next test. Stop them all before teardown.
  for (const ex of [...activeExecutors.values()]) {
    try { await ex.cancel(); } catch { /* already gone */ }
  }
  activeExecutors.clear();
  delete (globalThis as Record<string, unknown>).localStorage;
  resetGoalStore();
  resetProjectQueues();
  resetUsageCache();
});

describe('GoalExecutor', () => {
  it('plans, gates on approval, executes tasks in dep order, completes', async () => {
    script.push(
      PLAN,
      '<task_result status="done" summary="first done"/>',
      '<task_result status="done" summary="second done"/>',
    );
    const run = startGoal(project, 'Build the thing', dispatch);
    expect(getAppState().sessions.some((s) => s.id === run.sessionId)).toBe(true);

    await waitFor(() => getGoalRun(run.id)?.status === 'awaiting_plan_approval');
    expect(getGoalRun(run.id)?.tasks).toHaveLength(2);

    await activeExecutors.get(run.id)!.approvePlan();
    await waitFor(() => getGoalRun(run.id)?.status === 'completed');

    const final = getGoalRun(run.id)!;
    expect(final.tasks.map((t) => t.status)).toEqual(['done', 'done']);
    expect(final.tasks[0].resultSummary).toBe('first done');
    // The second task's driver prompt carried the first task's summary —
    // state-derived context, not transcript replay.
    const secondDriver = seenRequests[2];
    const driverText = JSON.stringify(secondDriver.messages);
    expect(driverText).toContain('first done');
    expect(driverText).toContain('do second');
    // Usage telemetry accumulated.
    expect(final.usage.input).toBeGreaterThan(0);
  });

  it('failed task retries once, then blocks dependents', async () => {
    script.push(
      PLAN,
      '<task_result status="failed" summary="broke"/>',
      '<task_result status="failed" summary="still broke"/>',
    );
    const run = startGoal(project, 'Doomed goal', dispatch, { approveGate: false });
    await waitFor(() => {
      const r = getGoalRun(run.id);
      return r?.status === 'failed' || r?.status === 'completed';
    });
    const final = getGoalRun(run.id)!;
    expect(final.status).toBe('failed');
    expect(final.tasks[0].status).toBe('failed');
    expect(final.tasks[0].attempts).toBe(2);
    expect(final.tasks[1].status).toBe('blocked');
  });

  it('pauses when no plan is produced', async () => {
    script.push('I refuse to make a plan.', 'Still no plan from me.', 'Nope, not this time either.');
    const run = startGoal(project, 'Planless', dispatch, { approveGate: false });
    await waitFor(() => getGoalRun(run.id)?.status === 'failed');
    expect(getGoalRun(run.id)?.pauseReason).toContain('no parseable plan');
    // Three planning turns were attempted (initial + two corrective retries).
    expect(seenRequests).toHaveLength(3);
    expect(getGoalRun(run.id)?.events.some((e) => e.kind === 'plan_retry')).toBe(true);
  });

  it('recovers when the corrective retry produces the plan', async () => {
    script.push(
      'Oops, prose only.',
      PLAN,
      '<task_result status="done" summary="first done"/>',
      '<task_result status="done" summary="second done"/>',
    );
    const run = startGoal(project, 'Second chance', dispatch, { approveGate: false });
    await waitFor(() => getGoalRun(run.id)?.status === 'completed');
    expect(getGoalRun(run.id)?.tasks).toHaveLength(2);
  });

  it('seeds the goal session with the launching session model', () => {
    const model = { providerId: 'gemini', modelId: 'gemini-2.5-flash' };
    const run = startGoal(project, 'Model carry-over', dispatch, { model });
    expect(run.model).toEqual(model);
    const session = getAppState().sessions.find((s) => s.id === run.sessionId);
    expect(session?.modelConfig?.model).toEqual(model);
  });

  it('cost limit pauses the run before the next task', async () => {
    script.push(PLAN);
    // Cap below the cost the plan turn itself records (mock-model is unpriced,
    // so use 0 — any recorded cost ≥ 0 trips a 0 cap).
    const run = startGoal(project, 'Capped goal', dispatch, { approveGate: false, costLimitUSD: 0 });
    await waitFor(() => getGoalRun(run.id)?.status === 'paused');
    expect(getGoalRun(run.id)?.pauseReason).toBe('cost_limit');
    // Checkpoint on disk reflects the pause (resumable after restart).
    const raw = localStorage.getItem(`code-agent:asset:${project.id}:goals/${run.id}.json`);
    expect(raw).toContain('"paused"');
  });
});
