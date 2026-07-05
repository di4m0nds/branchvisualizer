import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fallbackSummary, parseGoalPlan, parseTaskResult } from './parse';
import { appendEvent, getGoalRun, removeRun, resetGoalStore, saveRun } from './goalStore';
import type { GoalRun } from '@/types/goals';
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

beforeEach(() => {
  stubLocalStorage();
  resetGoalStore();
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
  resetGoalStore();
  vi.restoreAllMocks();
});

describe('parseGoalPlan', () => {
  it('parses a fenced JSON plan with deps and verify commands', () => {
    const text = `Here is my plan.
<goal_plan>
\`\`\`json
[
  {"id":"t1","title":"Scaffold module","description":"create files","deps":[]},
  {"id":"t2","title":"Wire API","deps":["t1"],"verify_command":"pnpm test"},
  {"id":"t3","title":"Deploy","deps":["t2"],"needsApproval":true}
]
\`\`\`
</goal_plan>`;
    const tasks = parseGoalPlan(text);
    expect(tasks).toHaveLength(3);
    expect(tasks[1].deps).toEqual(['t1']);
    expect(tasks[1].verify?.command).toBe('pnpm test');
    expect(tasks[2].needsApproval).toBe(true);
    // description defaults to title when missing
    expect(tasks[1].description).toBe('Wire API');
  });

  it('heals missing/duplicate ids and drops unknown deps', () => {
    const tasks = parseGoalPlan(`<goal_plan>[
      {"title":"A"},
      {"id":"t1","title":"B","deps":["ghost","t1"]},
      {"id":"t1","title":"C","deps":["t1"]}
    ]</goal_plan>`);
    expect(tasks.map((t) => t.id)).toEqual(['t1', 't1_x', 't1_x_x']);
    expect(tasks[1].deps).toEqual(['t1']); // ghost dropped, self-dep dropped
  });

  it('returns [] for prose without a plan or unparseable JSON', () => {
    expect(parseGoalPlan('no plan here')).toEqual([]);
    expect(parseGoalPlan('<goal_plan>not json</goal_plan>')).toEqual([]);
  });

  it('parses a plan whose closing tag was truncated away', () => {
    const tasks = parseGoalPlan(`<goal_plan>
[{"id":"t1","title":"A","deps":[]},{"id":"t2","title":"B","deps":["t1"]}]`);
    expect(tasks.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('salvages complete objects from an array truncated mid-object', () => {
    const tasks = parseGoalPlan(`<goal_plan>
[{"id":"t1","title":"A","deps":[]},
 {"id":"t2","title":"B {braces} in \\"string\\"","deps":["t1"]},
 {"id":"t3","title":"C","descrip`);
    expect(tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(tasks[1].title).toContain('{braces}');
  });

  it('salvages a fenced plan truncated mid-object', () => {
    const tasks = parseGoalPlan(`<goal_plan>
\`\`\`json
[{"id":"t1","title":"A","deps":[]},{"id":"t2","title":"B","de`);
    expect(tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('falls back to a fenced JSON array when the <goal_plan> tag is missing', () => {
    const text = `Sure, here's the plan:
\`\`\`json
[{"id":"t1","title":"Set up","deps":[]},{"id":"t2","title":"Build","deps":["t1"]}]
\`\`\`
Let me know if that works.`;
    expect(parseGoalPlan(text).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('falls back to a bare top-level JSON array with no tag or fence', () => {
    const text = 'Plan: [{"title":"Alpha"},{"title":"Beta"},{"title":"Gamma"}]';
    expect(parseGoalPlan(text).map((t) => t.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('does not misread an unrelated JSON array as a plan', () => {
    // No title fields → not task-shaped, so it must be ignored.
    expect(parseGoalPlan('The scores were [1, 2, 3] yesterday.')).toEqual([]);
    expect(parseGoalPlan('Coords: [{"x":1,"y":2},{"x":3,"y":4}]')).toEqual([]);
  });

  it('rejects tasks that echo the prompt placeholder titles', () => {
    const echoed = `<goal_plan>[{"id":"t1","title":"short imperative","description":"what to do and how to know it's done","deps":[]}]</goal_plan>`;
    expect(parseGoalPlan(echoed)).toEqual([]);
    // A placeholder mixed with a real task keeps only the real one.
    const mixed = `<goal_plan>[{"id":"t1","title":"<imperative task title>"},{"id":"t2","title":"Ship the footer"}]</goal_plan>`;
    expect(parseGoalPlan(mixed).map((t) => t.title)).toEqual(['Ship the footer']);
  });
});

describe('parseTaskResult', () => {
  it('parses self-closing and body forms; last occurrence wins', () => {
    expect(parseTaskResult('<task_result status="done" summary="did it"/>'))
      .toEqual({ status: 'done', summary: 'did it' });
    expect(parseTaskResult('<task_result status="failed">missing dep</task_result>'))
      .toEqual({ status: 'failed', summary: 'missing dep' });
    const two = 'a <task_result status="failed" summary="first"/> b <task_result status="done" summary="second"/>';
    expect(parseTaskResult(two)?.summary).toBe('second');
  });

  it('rejects malformed tags; fallbackSummary compacts prose', () => {
    expect(parseTaskResult('<task_result status="maybe" summary="x"/>')).toBeNull();
    expect(parseTaskResult('plain text')).toBeNull();
    expect(fallbackSummary('  did\n\nthings   here  ')).toBe('did things here');
  });
});

describe('goalStore', () => {
  const project: Project = { id: 'p1', name: 'x', path: '/tmp/x', source: 'local', createdAt: '2026-01-01' };

  function makeRun(over: Partial<GoalRun> = {}): GoalRun {
    return {
      id: 'goal_1', projectId: 'p1', sessionId: 's1', goal: 'ship it',
      status: 'running', tasks: [], usage: { input: 0, output: 0, costUSD: 0 },
      events: [], createdAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
      pendingApproval: null,
      ...over,
    };
  }

  it('saveRun checkpoints to the project store and tracks active pointers', async () => {
    await saveRun(project, makeRun());
    expect(getGoalRun('goal_1')?.status).toBe('running');
    const ptrs = JSON.parse(localStorage.getItem('code-agent:active_goals') ?? '[]');
    expect(ptrs).toEqual([{ goalId: 'goal_1', projectId: 'p1' }]);
    // Browser fallback store: the checkpoint file exists.
    expect(localStorage.getItem('code-agent:asset:p1:goals/goal_1.json')).toContain('"ship it"');

    // Terminal status drops the pointer but keeps the file.
    await saveRun(project, makeRun({ status: 'completed' }));
    expect(JSON.parse(localStorage.getItem('code-agent:active_goals') ?? '[]')).toEqual([]);
    expect(localStorage.getItem('code-agent:asset:p1:goals/goal_1.json')).toContain('"completed"');
  });

  it('appendEvent caps the log', () => {
    let run = makeRun();
    for (let i = 0; i < 520; i++) run = appendEvent(run, 'tick', String(i));
    expect(run.events).toHaveLength(500);
    expect(run.events[run.events.length - 1].detail).toBe('519');
  });

  it('removeRun drops memory, pointer, and the checkpoint file', async () => {
    await saveRun(project, makeRun());
    expect(getGoalRun('goal_1')).not.toBeNull();
    expect(localStorage.getItem('code-agent:asset:p1:goals/goal_1.json')).not.toBeNull();

    await removeRun(project, 'goal_1');
    expect(getGoalRun('goal_1')).toBeNull();
    expect(JSON.parse(localStorage.getItem('code-agent:active_goals') ?? '[]')).toEqual([]);
    expect(localStorage.getItem('code-agent:asset:p1:goals/goal_1.json')).toBeNull();
  });

  it('round-trips a GoalRun through JSON intact', async () => {
    const run = makeRun({
      tasks: [{
        id: 't1', title: 'A', description: 'do A', deps: [], status: 'done',
        attempts: 1, resultSummary: 'done A', verify: { command: 'true', passed: true },
      }],
      usage: { input: 100, output: 50, costUSD: 0.01 },
    });
    await saveRun(project, run);
    const raw = localStorage.getItem('code-agent:asset:p1:goals/goal_1.json')!;
    const parsed = JSON.parse(raw) as GoalRun;
    expect(parsed.tasks[0]).toEqual(run.tasks[0]);
    expect(parsed.usage).toEqual(run.usage);
  });
});
