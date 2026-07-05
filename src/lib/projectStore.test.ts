import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getProjectStore } from './projectStore';
import type { Project } from '../types/session';

// Full localStorage stub (the browser store iterates via length/key()).
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

beforeEach(stubLocalStorage);
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

const project: Project = {
  id: 'p_test_1',
  name: 'demo',
  path: '/tmp/demo',
  source: 'local',
  createdAt: '2026-01-01T00:00:00Z',
};

// Not in Tauri during tests → getProjectStore returns the browser fallback.
describe('projectStore (browser fallback)', () => {
  it('write/read/remove round trip', async () => {
    const s = getProjectStore(project);
    expect(s.durable).toBe(false);
    expect(await s.read('kb/notes/a.md')).toBeNull();
    await s.write('kb/notes/a.md', 'hello');
    expect(await s.read('kb/notes/a.md')).toBe('hello');
    await s.remove('kb/notes/a.md');
    expect(await s.read('kb/notes/a.md')).toBeNull();
  });

  it('list surfaces files and synthesizes directories', async () => {
    const s = getProjectStore(project);
    await s.write('kb/index.json', '[]');
    await s.write('kb/notes/a.md', 'a');
    await s.write('diagrams/x.excalidraw', '{}');
    const top = await s.list('');
    expect(top.map((e) => `${e.name}${e.isDir ? '/' : ''}`).sort()).toEqual(['diagrams/', 'kb/']);
    const kb = await s.list('kb');
    expect(kb.find((e) => e.name === 'notes')?.isDir).toBe(true);
    expect(kb.find((e) => e.name === 'index.json')?.isDir).toBe(false);
    expect(kb.find((e) => e.name === 'index.json')?.path).toBe('kb/index.json');
  });

  it('directory remove drops nested keys; rename moves content', async () => {
    const s = getProjectStore(project);
    await s.write('kb/notes/a.md', 'a');
    await s.write('kb/notes/b.md', 'b');
    await s.rename('kb/notes/a.md', 'kb/notes/c.md');
    expect(await s.read('kb/notes/a.md')).toBeNull();
    expect(await s.read('kb/notes/c.md')).toBe('a');
    await s.remove('kb/notes');
    expect(await s.read('kb/notes/b.md')).toBeNull();
    expect(await s.read('kb/notes/c.md')).toBeNull();
  });

  it('enforces the per-project soft cap', async () => {
    const s = getProjectStore({ ...project, id: 'p_cap' });
    const big = 'x'.repeat(400 * 1024);
    await s.write('a', big);
    await expect(s.write('b', big)).rejects.toThrow(/storage cap/);
    // Overwriting the existing key stays within the cap.
    await expect(s.write('a', big)).resolves.toBeUndefined();
  });

  it('projects are isolated from each other', async () => {
    const a = getProjectStore({ ...project, id: 'p_iso_a' });
    const b = getProjectStore({ ...project, id: 'p_iso_b' });
    await a.write('kb/notes/x.md', 'from-a');
    expect(await b.read('kb/notes/x.md')).toBeNull();
    expect(await b.list('kb')).toEqual([]);
  });
});
