import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapProjectsAndSessions, normalizeModelRef } from './persistence';

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
}

beforeEach(stubLocalStorage);
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

const rawSession = {
  id: 's1',
  title: 'old session',
  projectId: 'p1',
  repoSource: 'local',
  repoRef: '/tmp/demo',
  cwd: '/tmp/demo',
  context: {},
  messages: [],
  terminals: [],
};

describe('per-session model migration', () => {
  it('heals sessions without modelConfig using the global model', () => {
    localStorage.setItem('code-agent:projects', JSON.stringify([
      { id: 'p1', name: 'demo', path: '/tmp/demo', source: 'local', createdAt: '2026-01-01' },
    ]));
    localStorage.setItem('code-agent:sessions', JSON.stringify([rawSession]));
    localStorage.setItem('code-agent:current_model', JSON.stringify(
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-6', context: 'standard' },
    ));
    const { sessions } = bootstrapProjectsAndSessions();
    expect(sessions[0].modelConfig).toEqual({
      model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6', context: 'standard' },
    });
  });

  it('preserves and normalizes an existing modelConfig', () => {
    localStorage.setItem('code-agent:sessions', JSON.stringify([{
      ...rawSession,
      modelConfig: {
        model: { providerId: 'anthropic', modelId: 'claude-haiku-4-5-20251001' },
        temperature: 0.3,
      },
    }]));
    const { sessions } = bootstrapProjectsAndSessions();
    // Haiku id drift healed + context defaulted; temperature untouched.
    expect(sessions[0].modelConfig?.model).toEqual({
      providerId: 'anthropic', modelId: 'claude-haiku-4-5', context: 'standard',
    });
    expect(sessions[0].modelConfig?.temperature).toBe(0.3);
  });

  it('falls back to the default model with no persisted global', () => {
    localStorage.setItem('code-agent:sessions', JSON.stringify([rawSession]));
    const { sessions } = bootstrapProjectsAndSessions();
    expect(sessions[0].modelConfig?.model.providerId).toBe('claude_code');
  });

  it('normalizeModelRef tolerates garbage', () => {
    expect(normalizeModelRef(null).providerId).toBe('claude_code');
    expect(normalizeModelRef({ context: 'bogus' }).context).toBe('standard');
    expect(normalizeModelRef({ providerId: 'ollama', modelId: 'llama3.1', context: '1m' }))
      .toEqual({ providerId: 'ollama', modelId: 'llama3.1', context: '1m' });
  });
});
