import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetPromptCacheForTests, getPrompt, hasOverride, listPrompts,
  renderPrompt, setPromptOverride,
} from './prompts';

function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

beforeEach(() => {
  stubLocalStorage();
  __resetPromptCacheForTests();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
  __resetPromptCacheForTests();
});

describe('prompt registry', () => {
  it('serves defaults when no override exists', () => {
    expect(getPrompt('denied_by_user')).toBe('Denied by user.');
    expect(getPrompt('base_system').length).toBeGreaterThan(10_000);
    expect(hasOverride('denied_by_user')).toBe(false);
  });

  it('returns empty string for unknown ids (callers own fallbacks)', () => {
    expect(getPrompt('skill_fragment.not_a_skill')).toBe('');
  });

  it('override round-trips and persists to localStorage', () => {
    setPromptOverride('plan_approved', 'GO GO GO');
    expect(getPrompt('plan_approved')).toBe('GO GO GO');
    expect(hasOverride('plan_approved')).toBe(true);

    // A fresh cache (new session) reads it back from storage.
    __resetPromptCacheForTests();
    expect(getPrompt('plan_approved')).toBe('GO GO GO');
  });

  it('reset (null) and saving the default text both clear the override', () => {
    setPromptOverride('plan_approved', 'custom');
    setPromptOverride('plan_approved', null);
    expect(hasOverride('plan_approved')).toBe(false);

    const def = getPrompt('action_approved');
    setPromptOverride('action_approved', 'x');
    setPromptOverride('action_approved', def); // saving the default = no override
    expect(hasOverride('action_approved')).toBe(false);
  });

  it('ignores overrides for unknown template ids', () => {
    setPromptOverride('nope', 'x');
    expect(getPrompt('nope')).toBe('');
  });

  it('renderPrompt interpolates {vars} and leaves unknown placeholders intact', () => {
    const out = renderPrompt('blocked_by_rule', { rule: 'no rm -rf' });
    expect(out).toBe('Blocked by pinned rule: "no rm -rf". This cannot be overridden.');

    setPromptOverride('blocked_by_rule', 'Rule {rule} and {mystery}');
    expect(renderPrompt('blocked_by_rule', { rule: 'X' })).toBe('Rule X and {mystery}');
  });

  it('registers per-skill fragments for both provider paths', () => {
    const ids = listPrompts().map((t) => t.id);
    for (const skill of ['test_first', 'minimal_diff', 'accessibility']) {
      expect(ids).toContain(`skill_fragment.${skill}`);
      expect(ids).toContain(`cc_skill.${skill}`);
    }
    expect(getPrompt('skill_fragment.minimal_diff')).toContain('smallest change');
  });
});
