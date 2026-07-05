import { describe, expect, it, vi } from 'vitest';
import { runInTerminal, subscribeRunInTerminal } from './useRunInTerminal';

describe('useRunInTerminal bus', () => {
  it('returns false when no dock is subscribed', () => {
    expect(runInTerminal('no-sub-session', { command: 'ls', title: 'List' })).toBe(false);
  });

  it('delivers the command+title to a subscriber and returns true', () => {
    const handler = vi.fn();
    const unsub = subscribeRunInTerminal('s1', handler);
    const ok = runInTerminal('s1', { command: 'pnpm dev', title: 'Dev' });
    expect(ok).toBe(true);
    expect(handler).toHaveBeenCalledWith({ command: 'pnpm dev', title: 'Dev' });
    unsub();
  });

  it('stops delivering after unsubscribe (and reports no subscriber)', () => {
    const handler = vi.fn();
    const unsub = subscribeRunInTerminal('s2', handler);
    unsub();
    expect(runInTerminal('s2', { command: 'ls', title: 'x' })).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('isolates sessions from each other', () => {
    const a = vi.fn();
    const unsub = subscribeRunInTerminal('sa', a);
    expect(runInTerminal('sb', { command: 'ls', title: 'x' })).toBe(false);
    expect(a).not.toHaveBeenCalled();
    unsub();
  });
});
