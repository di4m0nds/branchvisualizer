import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAgentTurn } from './loop';
import { recordUsage, resetUsageCache } from './usageLog';
import { saveCostPrefs, DEFAULT_COST_PREFS } from './costPrefs';
import { createDefaultContext } from '@/types/session';
import type { Session } from '@/types/session';
import type { AgentTransport, NeutralResponse } from './transport';
import type { AppAction } from '@/types';

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
}

beforeEach(() => {
  stubLocalStorage();
  resetUsageCache();
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
  resetUsageCache();
});

function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 's_loop_test',
    title: 't',
    projectId: 'p1',
    repoSource: 'local',
    repoRef: '/tmp/x',
    cwd: '/tmp/x',
    context: createDefaultContext(),
    messages: [],
    terminals: [],
    ...over,
  };
}

const okResponse: NeutralResponse = {
  content: [{ type: 'text', text: 'done' }],
  stopReason: 'end_turn',
  usage: { inputTokens: 10, outputTokens: 5, total: 15 },
  providerModel: 'claude-sonnet-4-6',
};

function collectDispatch(): { actions: AppAction[]; dispatch: (a: AppAction) => void } {
  const actions: AppAction[] = [];
  return { actions, dispatch: (a) => actions.push(a) };
}

function errorBlocks(actions: AppAction[]): string[] {
  return actions
    .filter((a): a is Extract<AppAction, { type: 'ADD_AGENT_MESSAGE' }> => a.type === 'ADD_AGENT_MESSAGE')
    .flatMap((a) => a.message.blocks ?? [])
    .filter((b) => b.type === 'agent_error')
    .map((b) => b.raw);
}

describe('loop enforcement', () => {
  it('stops before the model call when the session cost cap is hit', async () => {
    saveCostPrefs({ ...DEFAULT_COST_PREFS, sessionCostLimitUSD: 0.01 });
    // Seed ≈$0.09 of prior spend for this session (sonnet pricing).
    recordUsage({
      ts: '2026-07-04T10:00:00Z', sessionId: 's_loop_test', projectId: 'p1',
      providerId: 'anthropic', modelId: 'claude-sonnet-4-6', input: 8000, output: 4000, task: 'main',
    });
    let called = 0;
    const transport: AgentTransport = {
      id: 'anthropic', modelId: 'claude-sonnet-4-6',
      createMessage: async () => { called += 1; return okResponse; },
    };
    const { actions, dispatch } = collectDispatch();
    await runAgentTurn(makeSession(), 'hello', {
      transport, dispatch, requestApproval: async () => true,
    }, new Date().toISOString());

    expect(called).toBe(0);
    expect(errorBlocks(actions).some((r) => r.includes('cost_limit'))).toBe(true);
  });

  it('per-session cap overrides the global', async () => {
    saveCostPrefs({ ...DEFAULT_COST_PREFS, sessionCostLimitUSD: 0.01 });
    let called = 0;
    const transport: AgentTransport = {
      id: 'anthropic', modelId: 'claude-sonnet-4-6',
      createMessage: async () => { called += 1; return okResponse; },
    };
    recordUsage({
      ts: '2026-07-04T10:00:00Z', sessionId: 's_loop_test', projectId: 'p1',
      providerId: 'anthropic', modelId: 'claude-sonnet-4-6', input: 8000, output: 4000, task: 'main',
    });
    const { actions, dispatch } = collectDispatch();
    // Session raises its own cap above the spend → the turn runs.
    const session = makeSession({
      modelConfig: { model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' }, costLimitUSD: 5 },
    });
    await runAgentTurn(session, 'hello', {
      transport, dispatch, requestApproval: async () => true,
    }, new Date().toISOString());
    expect(called).toBe(1);
    expect(errorBlocks(actions)).toHaveLength(0);
  });

  it('times out a hung model call as a real error (not a clean stop)', async () => {
    saveCostPrefs({ ...DEFAULT_COST_PREFS, turnTimeoutMs: 60 });
    const transport: AgentTransport = {
      id: 'anthropic', modelId: 'claude-sonnet-4-6',
      createMessage: (req) =>
        new Promise((_resolve, reject) => {
          req.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    };
    const { actions, dispatch } = collectDispatch();
    await runAgentTurn(makeSession(), 'hello', {
      transport, dispatch, requestApproval: async () => true,
    }, new Date().toISOString());

    const errs = errorBlocks(actions);
    expect(errs.some((r) => r.includes('timed out'))).toBe(true);
    const statuses = actions.filter((a) => a.type === 'SET_SESSION_STATUS');
    expect(statuses[statuses.length - 1]).toMatchObject({ status: 'error' });
  });

  it('honours the retry policy from prefs before failing', async () => {
    saveCostPrefs({ ...DEFAULT_COST_PREFS, maxRetries: 1 });
    let calls = 0;
    const transport: AgentTransport = {
      id: 'anthropic', modelId: 'claude-sonnet-4-6',
      createMessage: async () => {
        calls += 1;
        const e = new Error('429 rate limited') as Error & { status?: number };
        e.status = 429;
        throw e;
      },
    };
    const { dispatch } = collectDispatch();
    await runAgentTurn(makeSession(), 'hello', {
      transport, dispatch, requestApproval: async () => true,
    }, new Date().toISOString());
    expect(calls).toBe(2); // initial + 1 retry
  });
});
