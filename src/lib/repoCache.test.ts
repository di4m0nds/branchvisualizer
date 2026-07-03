import { describe, it, expect } from 'vitest';
import { getCachedRepo, setCachedRepo, hasCachedRepo, type CachedRepo } from './repoCache';

// Minimal stand-in — the cache never inspects the payload, only keys it.
const fake = (id: string) => ({ id } as unknown as CachedRepo);

describe('repoCache LRU', () => {
  it('stores and retrieves by ref', () => {
    setCachedRepo('a', fake('a'));
    expect(hasCachedRepo('a')).toBe(true);
    expect((getCachedRepo('a') as unknown as { id: string }).id).toBe('a');
  });

  it('ignores empty refs', () => {
    setCachedRepo('', fake('empty'));
    expect(hasCachedRepo('')).toBe(false);
  });

  it('evicts the least-recently-used entry past the cap', () => {
    // Fill well past the 12-entry cap.
    for (let i = 0; i < 20; i++) setCachedRepo(`k${i}`, fake(`k${i}`));
    // The earliest inserted keys should have been evicted.
    expect(hasCachedRepo('k0')).toBe(false);
    expect(hasCachedRepo('k7')).toBe(false);
    // The most recent should survive.
    expect(hasCachedRepo('k19')).toBe(true);
  });

  it('bumps recency on get so an active repo is not evicted', () => {
    for (let i = 0; i < 12; i++) setCachedRepo(`r${i}`, fake(`r${i}`));
    // Touch r0 so it becomes most-recently-used.
    getCachedRepo('r0');
    // Insert one more → the now-oldest (r1) is evicted, not r0.
    setCachedRepo('r12', fake('r12'));
    expect(hasCachedRepo('r0')).toBe(true);
    expect(hasCachedRepo('r1')).toBe(false);
  });
});
