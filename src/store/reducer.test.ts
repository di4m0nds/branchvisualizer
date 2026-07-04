import { afterEach, describe, expect, it } from 'vitest';
import { initialState, persistSessions, reducer } from './reducer';
import type { AppState, Commit } from '../types';
import type { AgentMessage, Session } from '../types/session';
import { createDefaultContext, nextId } from '../types/session';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeMessage(patch: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: nextId('msg_u'),
    role: 'user',
    text: 'hello',
    blocks: [],
    ts: new Date(0).toISOString(),
    ...patch,
  };
}

function makeSession(patch: Partial<Session> = {}): Session {
  return {
    id: nextId('session'),
    title: 'New session',
    projectId: 'p1',
    repoSource: 'local',
    repoRef: '/tmp/repo',
    cwd: '/tmp/repo',
    context: createDefaultContext(),
    messages: [],
    terminals: [],
    ...patch,
  };
}

function makeCommit(sha: string, subject: string, parents: string[] = []): Commit {
  const author = { name: 'a', email: 'a@x', date: new Date(0).toISOString() };
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: subject,
    subject,
    body: '',
    author,
    committer: author,
    parents,
    isMerge: parents.length > 1,
  };
}

function withSessions(sessions: Session[], active: string | null = null): AppState {
  return { ...initialState, sessions, activeSessionId: active };
}

// A localStorage stub for persistence tests (vitest runs in a node env).
function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

// ─── Sessions domain ─────────────────────────────────────────────────────────

describe('CREATE_SESSION', () => {
  it('seeds the new session pinned rules from the app-global set and activates it', () => {
    const globalRule = { id: 'custom', text: 'No deletes.' };
    const state: AppState = { ...initialState, pinnedRules: [globalRule] };
    const session = makeSession();
    const next = reducer(state, { type: 'CREATE_SESSION', session });
    expect(next.sessions).toHaveLength(1);
    expect(next.activeSessionId).toBe(session.id);
    expect(next.sessions[0].context.pinnedRules).toEqual([globalRule]);
    // deep-copied, not shared references
    expect(next.sessions[0].context.pinnedRules[0]).not.toBe(globalRule);
  });
});

describe('CLOSE_SESSION', () => {
  it('removes the session and falls back to the last remaining one when active', () => {
    const [a, b, c] = [makeSession(), makeSession(), makeSession()];
    const state = withSessions([a, b, c], b.id);
    const next = reducer(state, { type: 'CLOSE_SESSION', id: b.id });
    expect(next.sessions.map((s) => s.id)).toEqual([a.id, c.id]);
    expect(next.activeSessionId).toBe(c.id);
  });

  it('keeps the active id when closing a different session', () => {
    const [a, b] = [makeSession(), makeSession()];
    const next = reducer(withSessions([a, b], a.id), { type: 'CLOSE_SESSION', id: b.id });
    expect(next.activeSessionId).toBe(a.id);
  });

  it('sets active to null when the last session closes', () => {
    const a = makeSession();
    const next = reducer(withSessions([a], a.id), { type: 'CLOSE_SESSION', id: a.id });
    expect(next.sessions).toHaveLength(0);
    expect(next.activeSessionId).toBeNull();
  });
});

describe('ADD_AGENT_MESSAGE', () => {
  it('derives the session title from the first user message when placeholder', () => {
    const s = makeSession({ title: 'New session' });
    const msg = makeMessage({ text: '  Fix the   flaky test\nsecond line' });
    const next = reducer(withSessions([s]), { type: 'ADD_AGENT_MESSAGE', sessionId: s.id, message: msg });
    expect(next.sessions[0].title).toBe('Fix the flaky test');
  });

  it('truncates long derived titles with an ellipsis', () => {
    const s = makeSession();
    const msg = makeMessage({ text: 'x'.repeat(80) });
    const next = reducer(withSessions([s]), { type: 'ADD_AGENT_MESSAGE', sessionId: s.id, message: msg });
    expect(next.sessions[0].title.length).toBeLessThanOrEqual(48);
    expect(next.sessions[0].title.endsWith('…')).toBe(true);
  });

  it('does not retitle once a user message exists', () => {
    const s = makeSession({ title: 'Existing', messages: [makeMessage({ text: 'earlier' })] });
    const next = reducer(withSessions([s]), {
      type: 'ADD_AGENT_MESSAGE',
      sessionId: s.id,
      message: makeMessage({ text: 'later prompt' }),
    });
    expect(next.sessions[0].title).toBe('Existing');
  });

  it('re-mints duplicate message ids so streamed updates cannot patch the wrong message', () => {
    const existing = makeMessage();
    const s = makeSession({ messages: [existing] });
    const dupe = makeMessage({ id: existing.id, text: 'dupe' });
    const next = reducer(withSessions([s]), { type: 'ADD_AGENT_MESSAGE', sessionId: s.id, message: dupe });
    const ids = next.sessions[0].messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('UPDATE_AGENT_MESSAGE', () => {
  it('patches only the targeted message', () => {
    const [m1, m2] = [makeMessage(), makeMessage({ role: 'assistant', text: 'draft' })];
    const s = makeSession({ messages: [m1, m2] });
    const next = reducer(withSessions([s]), {
      type: 'UPDATE_AGENT_MESSAGE',
      sessionId: s.id,
      messageId: m2.id,
      patch: { text: 'final', streaming: false },
    });
    expect(next.sessions[0].messages[0].text).toBe('hello');
    expect(next.sessions[0].messages[1].text).toBe('final');
  });
});

describe('TRUNCATE_MESSAGES_BEFORE', () => {
  it('drops the anchor message and everything after it', () => {
    const [m1, m2, m3] = [makeMessage(), makeMessage(), makeMessage()];
    const s = makeSession({ messages: [m1, m2, m3] });
    const next = reducer(withSessions([s]), {
      type: 'TRUNCATE_MESSAGES_BEFORE',
      sessionId: s.id,
      beforeMessageId: m2.id,
    });
    expect(next.sessions[0].messages.map((m) => m.id)).toEqual([m1.id]);
  });

  it('is a no-op when the anchor id is unknown', () => {
    const s = makeSession({ messages: [makeMessage()] });
    const next = reducer(withSessions([s]), {
      type: 'TRUNCATE_MESSAGES_BEFORE',
      sessionId: s.id,
      beforeMessageId: 'missing',
    });
    expect(next.sessions[0].messages).toHaveLength(1);
  });
});

describe('PATCH_SESSION_CONTEXT', () => {
  it('merges a partial context patch into the targeted session only', () => {
    const [a, b] = [makeSession(), makeSession()];
    const next = reducer(withSessions([a, b]), {
      type: 'PATCH_SESSION_CONTEXT',
      sessionId: b.id,
      patch: { accessLevel: 'full_access' },
    });
    expect(next.sessions[0].context.accessLevel).toBe('supervised');
    expect(next.sessions[1].context.accessLevel).toBe('full_access');
    expect(next.sessions[1].context.buildMode).toBe('direct');
  });
});

// ─── Projects domain ─────────────────────────────────────────────────────────

describe('REMOVE_PROJECT', () => {
  const project = { id: 'p1', name: 'repo', path: '/tmp/repo', source: 'local' as const, createdAt: new Date(0).toISOString() };

  it('cascades to the project sessions and recomputes the active id', () => {
    const inP1 = makeSession({ projectId: 'p1' });
    const other = makeSession({ projectId: 'p2' });
    const state: AppState = { ...withSessions([inP1, other], inP1.id), projects: [project] };
    const next = reducer(state, { type: 'REMOVE_PROJECT', id: 'p1' });
    expect(next.projects).toHaveLength(0);
    expect(next.sessions.map((s) => s.id)).toEqual([other.id]);
    expect(next.activeSessionId).toBe(other.id);
  });
});

// ─── Graph domain ────────────────────────────────────────────────────────────

describe('SET_SHOW_CHECKPOINTS / SET_GRAPH_DATA', () => {
  it('SET_SHOW_CHECKPOINTS only stores the flag (rebuild happens off-reducer)', () => {
    const regular = makeCommit('a'.repeat(40), 'feat: real work');
    const state: AppState = { ...initialState, allCommits: [regular], graphData: null };
    const next = reducer(state, { type: 'SET_SHOW_CHECKPOINTS', show: true });
    expect(next.showCheckpoints).toBe(true);
    expect(next.graphData).toBeNull();
    expect(next.allCommits).toBe(state.allCommits); // untouched — no rebuild in dispatch
  });

  it('SET_GRAPH_DATA swaps the rebuilt graph in and clears the selection', () => {
    const regular = makeCommit('a'.repeat(40), 'feat: real work');
    const checkpoint = makeCommit('b'.repeat(40), 't3 checkpoint snapshot', [regular.sha]);
    const fakeNode = { commit: regular } as unknown as AppState['selectedNode'];
    const state: AppState = {
      ...initialState,
      rawCommits: [checkpoint, regular],
      allCommits: [checkpoint, regular],
      selectedNode: fakeNode,
      selectedNodes: [fakeNode!],
    };
    const rebuilt = { nodes: [], edges: [] } as unknown as NonNullable<AppState['graphData']>;
    const next = reducer(state, { type: 'SET_GRAPH_DATA', graphData: rebuilt, allCommits: [regular] });
    expect(next.graphData).toBe(rebuilt);
    expect(next.allCommits.map((c) => c.subject)).toEqual(['feat: real work']);
    expect(next.selectedNode).toBeNull();
    expect(next.selectedNodes).toEqual([]);
  });
});

// ─── Prefs / model domain ────────────────────────────────────────────────────

describe('model + pinned rules', () => {
  it('SET_MODEL replaces the current model ref', () => {
    const model = { providerId: 'anthropic', modelId: 'claude-sonnet-5', context: 'standard' as const };
    expect(reducer(initialState, { type: 'SET_MODEL', model }).currentModel).toEqual(model);
  });

  it('pinned rule CRUD', () => {
    const rule = { id: 'r1', text: 'no rm -rf' };
    let state = reducer({ ...initialState, pinnedRules: [] }, { type: 'ADD_PINNED_RULE', rule });
    expect(state.pinnedRules).toEqual([rule]);
    state = reducer(state, { type: 'UPDATE_PINNED_RULE', ruleId: 'r1', patch: { text: 'edited' } });
    expect(state.pinnedRules[0].text).toBe('edited');
    state = reducer(state, { type: 'REMOVE_PINNED_RULE', ruleId: 'r1' });
    expect(state.pinnedRules).toHaveLength(0);
  });
});

// ─── Persistence ─────────────────────────────────────────────────────────────

describe('persistSessions', () => {
  it('caps history at 100 messages, drops hiddenText, and clears runtime fields', () => {
    const store = stubLocalStorage();
    const messages = Array.from({ length: 120 }, (_, i) =>
      makeMessage({ text: `m${i}`, hiddenText: 'resolved @file contents', streaming: true }),
    );
    const s = makeSession({ messages, terminals: ['t1'] });
    s.context.status = 'running';
    persistSessions(withSessions([s], s.id));

    const raw = store.get('code-agent:sessions');
    expect(raw).toBeTruthy();
    const [persisted] = JSON.parse(raw!) as Session[];
    expect(persisted.messages).toHaveLength(100);
    expect(persisted.messages[0].text).toBe('m20');
    expect(persisted.messages.every((m) => !('hiddenText' in m))).toBe(true);
    expect(persisted.messages.every((m) => m.streaming === false)).toBe(true);
    expect(persisted.terminals).toEqual([]);
    expect(persisted.context.status).toBe('idle');
    expect(persisted.historyTrimmed).toBe(true);
    expect(store.get('code-agent:active_session')).toBe(JSON.stringify(s.id));
  });

  it('swallows storage quota errors instead of throwing', () => {
    stubLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    };
    expect(() => persistSessions(withSessions([makeSession()]))).not.toThrow();
  });
});
