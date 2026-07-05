// ─── Project knowledge base store ────────────────────────────────────────────
// Project-level notes (markdown) shared by every session of a project and
// readable by the agent. Data lives on disk through the project asset store
// (`.code-agent/kb/` for local projects) — NOT in the app reducer, whose
// persistence is localStorage-shaped. This module is a small external store
// (useSyncExternalStore) with a per-project in-memory cache.
//
// Layout under the asset root:
//   kb/index.json               [{id,slug,title,folder,tags,pinned,createdAt,updatedAt,version}]
//   kb/notes/<id>.md            markdown body
//   kb/.versions/<id>/<ts>.md   last N snapshots (desktop only)

import { useSyncExternalStore } from 'react';
import type { Project } from '@/types/session';
import { nextId } from '@/types/session';
import { getProjectStore, type ProjectStore } from '@/lib/projectStore';

export interface KbNoteMeta {
  id: string;
  /** Stable kebab slug for @kb: mentions (derived from the title at creation,
   *  re-derived on rename; collisions get a numeric suffix). */
  slug: string;
  title: string;
  /** Folder path ('' = root). Plain string — folders are virtual. */
  folder: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  /** Monotonic save counter (history dialog labels). */
  version: number;
}

export const MAX_VERSIONS = 20;

interface ProjectKb {
  loaded: boolean;
  loading: Promise<void> | null;
  index: KbNoteMeta[];
  /** Lazily-loaded note bodies. */
  bodies: Map<string, string>;
}

const cache = new Map<string, ProjectKb>();
const listeners = new Set<() => void>();
// Bumped on every mutation; hooks select via getSnapshot closures.
let snapshotVersion = 0;

function emit(): void {
  snapshotVersion += 1;
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function entry(project: Project): ProjectKb {
  let kb = cache.get(project.id);
  if (!kb) {
    kb = { loaded: false, loading: null, index: [], bodies: new Map() };
    cache.set(project.id, kb);
  }
  return kb;
}

function store(project: Project): ProjectStore {
  return getProjectStore(project);
}

export function slugify(title: string): string {
  return title.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'note';
}

function uniqueSlug(index: KbNoteMeta[], title: string, excludeId?: string): string {
  const base = slugify(title);
  const taken = new Set(index.filter((n) => n.id !== excludeId).map((n) => n.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function persistIndex(project: Project): Promise<void> {
  const kb = entry(project);
  await store(project).write('kb/index.json', JSON.stringify(kb.index, null, 2));
}

// ─── Load ────────────────────────────────────────────────────────────────────

export async function loadKb(project: Project): Promise<void> {
  const kb = entry(project);
  if (kb.loaded) return;
  if (kb.loading) return kb.loading;
  kb.loading = (async () => {
    try {
      const raw = await store(project).read('kb/index.json');
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      kb.index = Array.isArray(parsed)
        ? (parsed as Partial<KbNoteMeta>[])
          .filter((n): n is KbNoteMeta => !!n && typeof n.id === 'string' && typeof n.title === 'string')
          .map((n) => ({
            // Heal older/partial blobs: default the optional-ish fields.
            ...n,
            tags: n.tags ?? [],
            folder: n.folder ?? '',
            pinned: n.pinned ?? false,
            version: n.version ?? 1,
            slug: n.slug ?? slugify(n.title),
          }))
        : [];
    } catch {
      kb.index = [];
    } finally {
      kb.loaded = true;
      kb.loading = null;
      emit();
    }
  })();
  return kb.loading;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export function getKbIndex(project: Project): KbNoteMeta[] {
  return entry(project).index;
}

export async function readNoteBody(project: Project, id: string): Promise<string> {
  const kb = entry(project);
  const cached = kb.bodies.get(id);
  if (cached !== undefined) return cached;
  const body = (await store(project).read(`kb/notes/${id}.md`)) ?? '';
  kb.bodies.set(id, body);
  return body;
}

export function findNote(project: Project, ref: string): KbNoteMeta | null {
  const needle = ref.trim().toLowerCase();
  const idx = entry(project).index;
  return idx.find((n) => n.id === ref)
    ?? idx.find((n) => n.slug === needle)
    ?? idx.find((n) => n.title.toLowerCase() === needle)
    ?? null;
}

/** Substring search across title, tags, folder, and (loaded) bodies. */
export async function searchNotes(project: Project, q: string): Promise<KbNoteMeta[]> {
  const kb = entry(project);
  const needle = q.trim().toLowerCase();
  if (!needle) return kb.index;
  // Bodies participate in search — load any that aren't cached yet.
  await Promise.all(kb.index.map((n) => readNoteBody(project, n.id).catch(() => '')));
  return kb.index.filter((n) =>
    n.title.toLowerCase().includes(needle)
    || n.folder.toLowerCase().includes(needle)
    || n.tags.some((t) => t.toLowerCase().includes(needle))
    || (kb.bodies.get(n.id) ?? '').toLowerCase().includes(needle));
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createNote(
  project: Project,
  init: { title: string; folder?: string; body?: string; tags?: string[]; pinned?: boolean },
): Promise<KbNoteMeta> {
  await loadKb(project);
  const kb = entry(project);
  const now = new Date().toISOString();
  const meta: KbNoteMeta = {
    id: nextId('note'),
    slug: uniqueSlug(kb.index, init.title),
    title: init.title,
    folder: init.folder ?? '',
    tags: init.tags ?? [],
    pinned: init.pinned ?? false,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  kb.index = [...kb.index, meta];
  kb.bodies.set(meta.id, init.body ?? '');
  await store(project).write(`kb/notes/${meta.id}.md`, init.body ?? '');
  await persistIndex(project);
  emit();
  return meta;
}

/** Snapshot the current body into .versions before overwriting (desktop only). */
async function snapshotVersionFile(project: Project, id: string): Promise<void> {
  const s = store(project);
  if (!s.durable) return;
  const current = await s.read(`kb/notes/${id}.md`);
  if (current === null || current === '') return;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await s.write(`kb/.versions/${id}/${ts}.md`, current);
  // Prune to the newest MAX_VERSIONS snapshots.
  const versions = (await s.list(`kb/.versions/${id}`))
    .filter((e) => !e.isDir)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const v of versions.slice(0, Math.max(0, versions.length - MAX_VERSIONS))) {
    await s.remove(v.path);
  }
}

export async function saveNote(
  project: Project,
  id: string,
  patch: { title?: string; folder?: string; tags?: string[]; pinned?: boolean; body?: string },
): Promise<void> {
  const kb = entry(project);
  const meta = kb.index.find((n) => n.id === id);
  if (!meta) throw new Error(`note not found: ${id}`);

  if (patch.body !== undefined && patch.body !== kb.bodies.get(id)) {
    await snapshotVersionFile(project, id);
    await store(project).write(`kb/notes/${id}.md`, patch.body);
    kb.bodies.set(id, patch.body);
  }

  const next: KbNoteMeta = {
    ...meta,
    ...(patch.title !== undefined ? { title: patch.title, slug: uniqueSlug(kb.index, patch.title, id) } : {}),
    ...(patch.folder !== undefined ? { folder: patch.folder } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
    updatedAt: new Date().toISOString(),
    version: meta.version + (patch.body !== undefined ? 1 : 0),
  };
  kb.index = kb.index.map((n) => (n.id === id ? next : n));
  await persistIndex(project);
  emit();
}

export async function deleteNote(project: Project, id: string): Promise<void> {
  const kb = entry(project);
  kb.index = kb.index.filter((n) => n.id !== id);
  kb.bodies.delete(id);
  const s = store(project);
  await s.remove(`kb/notes/${id}.md`);
  await s.remove(`kb/.versions/${id}`);
  await persistIndex(project);
  emit();
}

// ─── Version history ─────────────────────────────────────────────────────────

export interface NoteVersion {
  path: string;
  label: string; // timestamp-ish name
  modifiedAt?: number;
}

export async function listVersions(project: Project, id: string): Promise<NoteVersion[]> {
  const s = store(project);
  if (!s.durable) return [];
  const versions = await s.list(`kb/.versions/${id}`);
  return versions
    .filter((e) => !e.isDir)
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((e) => ({ path: e.path, label: e.name.replace(/\.md$/, ''), modifiedAt: e.modifiedAt }));
}

export async function readVersion(project: Project, path: string): Promise<string> {
  return (await store(project).read(path)) ?? '';
}

export async function restoreVersion(project: Project, id: string, path: string): Promise<void> {
  const body = await readVersion(project, path);
  await saveNote(project, id, { body });
}

// ─── Agent-facing helpers ────────────────────────────────────────────────────

/** One-line-per-note index for prompt injection / the list_knowledge tool. */
export async function kbIndexText(project: Project): Promise<string> {
  await loadKb(project);
  const idx = entry(project).index;
  if (idx.length === 0) return '';
  return idx
    .map((n) => `- ${n.slug}${n.pinned ? ' (pinned)' : ''}${n.folder ? ` [${n.folder}]` : ''}: ${n.title}`)
    .join('\n');
}

/** Pinned-note bodies capped for injection. */
export async function pinnedNotesBlock(project: Project, capBytes = 8 * 1024): Promise<string> {
  await loadKb(project);
  const pinned = entry(project).index.filter((n) => n.pinned);
  const parts: string[] = [];
  let budget = capBytes;
  for (const n of pinned) {
    if (budget <= 0) break;
    let body = await readNoteBody(project, n.id).catch(() => '');
    let truncated = false;
    if (body.length > budget) { body = body.slice(0, budget); truncated = true; }
    budget -= body.length;
    parts.push(`<note slug="${n.slug}" title="${n.title}"${truncated ? ' truncated="true"' : ''}>\n${body}\n</note>`);
  }
  return parts.join('\n');
}

// ─── React bindings ──────────────────────────────────────────────────────────

export function useKbIndex(project: Project | null): KbNoteMeta[] {
  return useSyncExternalStore(
    subscribe,
    () => (project ? entry(project).index : EMPTY_INDEX),
    () => EMPTY_INDEX,
  );
}
const EMPTY_INDEX: KbNoteMeta[] = [];

export function useKbLoaded(project: Project | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (project ? entry(project).loaded : false),
    () => false,
  );
}

/** Test hook: clear all per-project caches. */
export function resetKbCache(): void {
  cache.clear();
  emit();
}

// Keep the linter honest about the version counter (selected implicitly).
void snapshotVersion;
