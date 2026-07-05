// ─── Project diagram store ───────────────────────────────────────────────────
// Excalidraw scenes at the project level (like the knowledge base): shared by
// every session, autosaved to disk through the project asset store.
//
// Layout under the asset root:
//   diagrams/index.json          [{id,name,createdAt,updatedAt}]
//   diagrams/<id>.excalidraw     standard scene JSON {type:"excalidraw",elements,appState,files}

import { useSyncExternalStore } from 'react';
import type { Project } from '@/types/session';
import { nextId } from '@/types/session';
import { getProjectStore } from '@/lib/projectStore';
import { sceneToText, type SceneLike } from './serialize';

export interface DiagramMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectDiagrams {
  loaded: boolean;
  loading: Promise<void> | null;
  index: DiagramMeta[];
}

const cache = new Map<string, ProjectDiagrams>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function entry(project: Project): ProjectDiagrams {
  let d = cache.get(project.id);
  if (!d) {
    d = { loaded: false, loading: null, index: [] };
    cache.set(project.id, d);
  }
  return d;
}

async function persistIndex(project: Project): Promise<void> {
  await getProjectStore(project).write('diagrams/index.json', JSON.stringify(entry(project).index, null, 2));
}

export async function loadDiagrams(project: Project): Promise<void> {
  const d = entry(project);
  if (d.loaded) return;
  if (d.loading) return d.loading;
  d.loading = (async () => {
    try {
      const raw = await getProjectStore(project).read('diagrams/index.json');
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      d.index = Array.isArray(parsed)
        ? (parsed as DiagramMeta[]).filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string')
        : [];
    } catch {
      d.index = [];
    } finally {
      d.loaded = true;
      d.loading = null;
      emit();
    }
  })();
  return d.loading;
}

export function getDiagramIndex(project: Project): DiagramMeta[] {
  return entry(project).index;
}

export function findDiagram(project: Project, ref: string): DiagramMeta | null {
  const needle = ref.trim().toLowerCase();
  const idx = entry(project).index;
  return idx.find((m) => m.id === ref)
    ?? idx.find((m) => m.name.toLowerCase() === needle)
    ?? idx.find((m) => m.name.toLowerCase().replace(/\s+/g, '-') === needle)
    ?? null;
}

export async function createDiagram(project: Project, name: string, sceneJson?: string): Promise<DiagramMeta> {
  await loadDiagrams(project);
  const d = entry(project);
  const now = new Date().toISOString();
  const meta: DiagramMeta = { id: nextId('diag'), name, createdAt: now, updatedAt: now };
  d.index = [...d.index, meta];
  await getProjectStore(project).write(
    `diagrams/${meta.id}.excalidraw`,
    sceneJson ?? JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }),
  );
  await persistIndex(project);
  emit();
  return meta;
}

export async function readDiagramScene(project: Project, id: string): Promise<string | null> {
  return getProjectStore(project).read(`diagrams/${id}.excalidraw`);
}

export async function writeDiagramScene(project: Project, id: string, sceneJson: string): Promise<void> {
  const d = entry(project);
  await getProjectStore(project).write(`diagrams/${id}.excalidraw`, sceneJson);
  d.index = d.index.map((m) => (m.id === id ? { ...m, updatedAt: new Date().toISOString() } : m));
  await persistIndex(project);
  emit();
}

export async function renameDiagram(project: Project, id: string, name: string): Promise<void> {
  const d = entry(project);
  d.index = d.index.map((m) => (m.id === id ? { ...m, name, updatedAt: new Date().toISOString() } : m));
  await persistIndex(project);
  emit();
}

export async function duplicateDiagram(project: Project, id: string): Promise<DiagramMeta | null> {
  const src = entry(project).index.find((m) => m.id === id);
  if (!src) return null;
  const scene = await readDiagramScene(project, id);
  return createDiagram(project, `${src.name} copy`, scene ?? undefined);
}

export async function deleteDiagram(project: Project, id: string): Promise<void> {
  const d = entry(project);
  d.index = d.index.filter((m) => m.id !== id);
  await getProjectStore(project).remove(`diagrams/${id}.excalidraw`);
  await persistIndex(project);
  emit();
}

// ─── Agent-facing helpers ────────────────────────────────────────────────────

export async function diagramIndexText(project: Project): Promise<string> {
  await loadDiagrams(project);
  const idx = entry(project).index;
  if (idx.length === 0) return '';
  return idx.map((m) => `- ${m.name} (updated ${m.updatedAt.slice(0, 10)})`).join('\n');
}

/** Structural text of one diagram (see serialize.ts). Null when not found. */
export async function diagramText(project: Project, ref: string): Promise<string | null> {
  await loadDiagrams(project);
  const meta = findDiagram(project, ref);
  if (!meta) return null;
  const raw = await readDiagramScene(project, meta.id);
  if (!raw) return `<diagram name="${meta.name}" empty="true" />`;
  try {
    const scene = JSON.parse(raw) as SceneLike;
    return sceneToText(scene, meta.name);
  } catch {
    return `<diagram name="${meta.name}" error="unparseable scene" />`;
  }
}

// ─── React bindings ──────────────────────────────────────────────────────────

const EMPTY: DiagramMeta[] = [];

export function useDiagramIndex(project: Project | null): DiagramMeta[] {
  return useSyncExternalStore(
    subscribe,
    () => (project ? entry(project).index : EMPTY),
    () => EMPTY,
  );
}

export function useDiagramsLoaded(project: Project | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (project ? entry(project).loaded : false),
    () => false,
  );
}

/** Test hook: clear per-project caches. */
export function resetDiagramCache(): void {
  cache.clear();
  emit();
}
