import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createNote, deleteNote, findNote, getKbIndex, kbIndexText, loadKb,
  pinnedNotesBlock, readNoteBody, resetKbCache, saveNote, searchNotes, slugify,
} from './kbStore';
import { formatKbNotes, parseKbTokens, resolveKbRefs } from '../agent/references';
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
  resetKbCache();
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
  resetKbCache();
});

const project: Project = {
  id: 'p_kb', name: 'demo', path: '/tmp/demo', source: 'local', createdAt: '2026-01-01',
};

describe('kbStore', () => {
  it('creates, reads, updates, deletes', async () => {
    const meta = await createNote(project, { title: 'Coding Standards', body: '# Rules\nUse tabs? never.' });
    expect(meta.slug).toBe('coding-standards');
    expect(await readNoteBody(project, meta.id)).toContain('Use tabs');

    await saveNote(project, meta.id, { body: 'updated body', tags: ['style'] });
    expect(await readNoteBody(project, meta.id)).toBe('updated body');
    const updated = getKbIndex(project).find((n) => n.id === meta.id);
    expect(updated?.version).toBe(2);
    expect(updated?.tags).toEqual(['style']);

    await deleteNote(project, meta.id);
    expect(getKbIndex(project)).toHaveLength(0);
  });

  it('persists the index across a cache reset', async () => {
    await createNote(project, { title: 'Arch Decisions', pinned: true });
    resetKbCache();
    await loadKb(project);
    const idx = getKbIndex(project);
    expect(idx).toHaveLength(1);
    expect(idx[0].pinned).toBe(true);
    expect(idx[0].slug).toBe('arch-decisions');
  });

  it('slug collisions get numeric suffixes; rename re-slugs', async () => {
    const a = await createNote(project, { title: 'API Notes' });
    const b = await createNote(project, { title: 'API Notes' });
    expect(a.slug).toBe('api-notes');
    expect(b.slug).toBe('api-notes-2');
    await saveNote(project, b.id, { title: 'Payment API' });
    expect(getKbIndex(project).find((n) => n.id === b.id)?.slug).toBe('payment-api');
    expect(slugify('  Héllo,  World!  ')).toBe('h-llo-world');
  });

  it('findNote matches id, slug, and title; search spans bodies', async () => {
    const meta = await createNote(project, { title: 'Deploy Runbook', body: 'kubectl rollout restart' });
    expect(findNote(project, meta.id)?.id).toBe(meta.id);
    expect(findNote(project, 'deploy-runbook')?.id).toBe(meta.id);
    expect(findNote(project, 'Deploy Runbook')?.id).toBe(meta.id);
    expect(findNote(project, 'nope')).toBeNull();
    expect(await searchNotes(project, 'kubectl')).toHaveLength(1);
    expect(await searchNotes(project, 'zzz')).toHaveLength(0);
  });

  it('pinnedNotesBlock caps and only includes pinned notes', async () => {
    await createNote(project, { title: 'Pinned Big', body: 'x'.repeat(10_000), pinned: true });
    await createNote(project, { title: 'Unpinned', body: 'invisible', pinned: false });
    const block = await pinnedNotesBlock(project, 1024);
    expect(block).toContain('slug="pinned-big"');
    expect(block).toContain('truncated="true"');
    expect(block).not.toContain('invisible');
    const index = await kbIndexText(project);
    expect(index).toContain('pinned-big (pinned)');
    expect(index).toContain('unpinned');
  });
});

describe('@kb: references', () => {
  it('parses kb tokens and dedupes', () => {
    const parsed = parseKbTokens('see @kb:api-notes and @kb:api-notes plus @kb:other.');
    expect(parsed.map((p) => p.slug)).toEqual(['api-notes', 'other']);
  });

  it('resolves against the store; unknown slugs become error chips', async () => {
    await createNote(project, { title: 'API Notes', body: 'the api body' });
    const resolved = await resolveKbRefs(project, parseKbTokens('use @kb:api-notes and @kb:missing'));
    expect(resolved[0]).toMatchObject({ kind: 'note', status: 'ok', path: 'api-notes' });
    expect(resolved[0].body).toBe('the api body');
    expect(resolved[1]).toMatchObject({ kind: 'note', status: 'error' });
    const block = formatKbNotes(resolved);
    expect(block).toContain('<referenced_notes>');
    expect(block).toContain('the api body');
    expect(block).toContain('error="no such note"');
  });
});
