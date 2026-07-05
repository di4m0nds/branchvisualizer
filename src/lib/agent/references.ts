// ─── @-reference resolution ─────────────────────────────────────────────────
// Turns `@path` tokens in the composer into explicit model context. Parsing is
// deliberately strict: a token only counts as a reference when the path exists
// in the workspace tree, so emails (`user@host`), decorators (`@memo`) and `@`
// inside pasted code never resolve. Resolution reads file contents (capped),
// renders folder listings, and formats everything as a `<referenced_files>`
// block that travels with the user message as prompt-only `hiddenText`.

import { invoke } from '@/lib/platform';
import type { MessageRef } from '@/types/session';
import type { TreeEntry } from '@/hooks/useWorkspaceTree';

/** Per-file content cap. Head is kept; the ref is marked `truncated`. */
export const FILE_CAP_BYTES = 48 * 1024;
/** Total budget across all refs on one message. Overflow refs degrade to a note. */
export const TOTAL_CAP_BYTES = 192 * 1024;
/** Max entries rendered in a folder listing. */
export const FOLDER_ENTRY_CAP = 200;
/** Max README size auto-inlined alongside a folder listing. */
const README_CAP_BYTES = 16 * 1024;
/** Files larger than this are never read (binary/generated defense). */
const MAX_READ_BYTES = 1024 * 1024;

// Extensions that are never useful as inlined text.
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svgz',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'gz', 'tar', 'tgz', 'bz2', '7z', 'rar', 'jar',
  'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'o', 'a', 'class',
  'mp3', 'mp4', 'mov', 'avi', 'webm', 'ogg', 'wav', 'flac',
  'db', 'sqlite', 'ds_store',
]);

// Machine-generated files whose head is noise; skip with a note instead.
const SKIP_BASENAMES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'cargo.lock', 'bun.lockb',
]);

/** A parsed-but-unresolved token: the path exists in the tree. */
export interface ParsedRef {
  token: string;
  path: string;
  kind: 'file' | 'folder';
}

/** A resolved reference: `MessageRef` plus the prompt payload. */
export interface ResolvedRef extends MessageRef {
  /** Inlined content (file text or folder listing). Absent for errors/skips. */
  body?: string;
  /** Line count of the ORIGINAL file (before truncation). Files only. */
  lines?: number;
  /** Entry count of the full folder listing (before capping). Folders only. */
  entryCount?: number;
}

const TOKEN_RE = /(^|\s)@([A-Za-z0-9_./\\-]+)/g;
// Trailing characters that read as sentence punctuation, not path segments.
const TRAILING_PUNCT = /[.,;:!?/\\]$/;

/**
 * Extract `@path` reference tokens from a message. A token resolves only when
 * (a) the `@` sits at start-of-text or after whitespace, and (b) the path (with
 * trailing punctuation progressively stripped) matches a tree entry exactly.
 * Duplicates collapse to the first occurrence.
 */
export function parseRefTokens(
  text: string,
  byPath: ReadonlyMap<string, { isDir: boolean }>,
): ParsedRef[] {
  const out: ParsedRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) {
    let candidate = m[2];
    // `@src/utils.ts.` — the final dot is punctuation. Strip trailing
    // punctuation one char at a time until the remainder matches the tree.
    while (candidate && !byPath.has(candidate) && TRAILING_PUNCT.test(candidate)) {
      candidate = candidate.slice(0, -1);
    }
    const entry = byPath.get(candidate);
    if (!entry || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push({ token: `@${candidate}`, path: candidate, kind: entry.isDir ? 'folder' : 'file' });
  }
  return out;
}

/** Build the exact-path lookup `parseRefTokens` expects from tree entries. */
export function indexTree(entries: TreeEntry[]): Map<string, { isDir: boolean }> {
  const map = new Map<string, { isDir: boolean }>();
  for (const e of entries) map.set(e.path, { isDir: e.isDir });
  return map;
}

function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Render an indented listing of a folder's contents from cached tree entries. */
function folderListing(
  path: string,
  entries: TreeEntry[],
): { body: string; entryCount: number; capped: boolean } {
  const prefix = `${path}/`;
  const children = entries.filter((e) => e.path.startsWith(prefix));
  const lines = children.slice(0, FOLDER_ENTRY_CAP).map((e) => {
    const rel = e.path.slice(prefix.length);
    const depth = rel.split('/').length - 1;
    const indent = '  '.repeat(depth + 1);
    return e.isDir ? `${indent}${e.name}/` : `${indent}${e.name} (${formatSize(e.sizeBytes)})`;
  });
  const capped = children.length > FOLDER_ENTRY_CAP;
  const body = [
    `${baseOf(path)}/`,
    ...lines,
    ...(capped ? [`  … and ${children.length - FOLDER_ENTRY_CAP} more entries`] : []),
  ].join('\n');
  return { body, entryCount: children.length, capped };
}

/** Direct-child README of a folder, if present and small enough to inline. */
function findFolderReadme(path: string, entries: TreeEntry[]): TreeEntry | null {
  const prefix = `${path}/`;
  return entries.find((e) =>
    !e.isDir
    && e.path.startsWith(prefix)
    && !e.path.slice(prefix.length).includes('/')
    && /^readme(\.[a-z]+)?$/i.test(e.name)
    && e.sizeBytes <= README_CAP_BYTES,
  ) ?? null;
}

export type ReadFileFn = (path: string) => Promise<string>;

function defaultReadFile(root: string): ReadFileFn {
  return (path) => invoke<string>('agent_read_file', { root, path });
}

/**
 * Resolve parsed refs into prompt payloads. Never throws: unreadable, deleted,
 * binary, or over-budget refs come back with `status: 'error' | 'truncated'`
 * and a note — the send flow proceeds regardless, and the model is told what
 * was skipped and why.
 */
export async function resolveRefs(
  root: string,
  parsed: ParsedRef[],
  entries: TreeEntry[],
  readFile: ReadFileFn = defaultReadFile(root),
): Promise<ResolvedRef[]> {
  const out: ResolvedRef[] = [];
  let budget = TOTAL_CAP_BYTES;
  const inlined = new Set<string>();

  const pushFile = async (token: string, path: string, sizeHint: number | undefined, noteSuffix?: string) => {
    if (inlined.has(path)) return;
    inlined.add(path);
    const ext = extOf(path);
    if (BINARY_EXTS.has(ext)) {
      out.push({ token, path, kind: 'file', status: 'error', note: 'binary file — not inlined' });
      return;
    }
    if (SKIP_BASENAMES.has(baseOf(path).toLowerCase())) {
      out.push({ token, path, kind: 'file', status: 'error', note: 'lockfile — skipped' });
      return;
    }
    if (sizeHint !== undefined && sizeHint > MAX_READ_BYTES) {
      out.push({ token, path, kind: 'file', status: 'error', note: `too large (${formatSize(sizeHint)})` });
      return;
    }
    if (budget <= 0) {
      out.push({ token, path, kind: 'file', status: 'error', note: 'skipped — total context budget reached' });
      return;
    }
    let content: string;
    try {
      content = await readFile(path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const gone = /no such file|not found|os error 2/i.test(msg);
      out.push({
        token, path, kind: 'file', status: 'error',
        note: gone ? 'not found' : 'unreadable (binary?)',
      });
      return;
    }
    const lines = content.length ? content.split('\n').length : 0;
    const cap = Math.min(FILE_CAP_BYTES, budget);
    let status: ResolvedRef['status'] = 'ok';
    let note: string | undefined = noteSuffix;
    if (content.length > cap) {
      const head = content.slice(0, cap);
      const shownLines = head.split('\n').length;
      content = head;
      status = 'truncated';
      note = `first ${shownLines} of ${lines} lines${noteSuffix ? ` · ${noteSuffix}` : ''}`;
    }
    budget -= content.length;
    out.push({ token, path, kind: 'file', status, note, body: content, lines });
  };

  for (const ref of parsed) {
    if (ref.kind === 'file') {
      const size = entries.find((e) => e.path === ref.path)?.sizeBytes;
      await pushFile(ref.token, ref.path, size);
    } else {
      const { body, entryCount, capped } = folderListing(ref.path, entries);
      out.push({
        token: ref.token,
        path: ref.path,
        kind: 'folder',
        status: capped ? 'truncated' : 'ok',
        note: capped ? `showing ${FOLDER_ENTRY_CAP} of ${entryCount} entries` : undefined,
        body,
        entryCount,
      });
      const readme = findFolderReadme(ref.path, entries);
      if (readme) await pushFile(ref.token, readme.path, readme.sizeBytes, `README of ${ref.token}`);
    }
  }
  return out;
}

/** Strip prompt payloads down to the persistable chip metadata. */
export function toMessageRefs(resolved: ResolvedRef[]): MessageRef[] {
  return resolved.map(({ token, path, kind, status, note }) => ({ token, path, kind, status, note }));
}

// ─── Knowledge-base references (@kb:<slug>) ──────────────────────────────────
// A separate namespace from workspace paths: `@kb:` tokens resolve against the
// project's note index (slug or exact title), and inline the note body into
// the same hiddenText channel — which is what makes them work for CLI
// providers too.

const KB_TOKEN_RE = /(^|\s)@kb:([A-Za-z0-9-]+)/g;
/** Per-note cap for inlined @kb: bodies. */
export const KB_NOTE_CAP_BYTES = 24 * 1024;

export interface ParsedKbRef {
  token: string;
  slug: string;
}

export function parseKbTokens(text: string): ParsedKbRef[] {
  const out: ParsedKbRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(KB_TOKEN_RE)) {
    const slug = m[2];
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ token: `@kb:${slug}`, slug });
  }
  return out;
}

/** Resolve @kb: tokens to note bodies. Never throws — unknown slugs come back
 *  as error chips the model can see. */
export async function resolveKbRefs(
  project: import('@/types/session').Project,
  parsed: ParsedKbRef[],
): Promise<ResolvedRef[]> {
  if (parsed.length === 0) return [];
  const { findNote, loadKb, readNoteBody } = await import('../kb/kbStore');
  await loadKb(project);
  const out: ResolvedRef[] = [];
  for (const ref of parsed) {
    const note = findNote(project, ref.slug);
    if (!note) {
      out.push({ token: ref.token, path: ref.slug, kind: 'note', status: 'error', note: 'no such note' });
      continue;
    }
    let body = await readNoteBody(project, note.id).catch(() => '');
    let status: ResolvedRef['status'] = 'ok';
    let noteText: string | undefined;
    if (body.length > KB_NOTE_CAP_BYTES) {
      body = body.slice(0, KB_NOTE_CAP_BYTES);
      status = 'truncated';
      noteText = `first ${KB_NOTE_CAP_BYTES / 1024} KB`;
    }
    out.push({ token: ref.token, path: note.slug, kind: 'note', status, note: noteText, body });
  }
  return out;
}

// ─── Diagram references (@diagram:<name>) ────────────────────────────────────
// Resolve against the project's Excalidraw diagrams; the inlined payload is
// the structural serialization (nodes/edges/labels), not raw scene JSON.

const DIAGRAM_TOKEN_RE = /(^|\s)@diagram:([A-Za-z0-9-]+)/g;

export interface ParsedDiagramRef {
  token: string;
  name: string;
}

export function parseDiagramTokens(text: string): ParsedDiagramRef[] {
  const out: ParsedDiagramRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(DIAGRAM_TOKEN_RE)) {
    const name = m[2];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ token: `@diagram:${name}`, name });
  }
  return out;
}

/** Resolve @diagram: tokens to serialized structure. Never throws. */
export async function resolveDiagramRefs(
  project: import('@/types/session').Project,
  parsed: ParsedDiagramRef[],
): Promise<ResolvedRef[]> {
  if (parsed.length === 0) return [];
  const { diagramText } = await import('../diagrams/diagramStore');
  const out: ResolvedRef[] = [];
  for (const ref of parsed) {
    const body = await diagramText(project, ref.name).catch(() => null);
    if (!body) {
      out.push({ token: ref.token, path: ref.name, kind: 'diagram', status: 'error', note: 'no such diagram' });
      continue;
    }
    out.push({ token: ref.token, path: ref.name, kind: 'diagram', status: 'ok', body });
  }
  return out;
}

/** Format resolved diagrams as a prompt block. */
export function formatDiagrams(resolved: ResolvedRef[]): string {
  const diagrams = resolved.filter((r) => r.kind === 'diagram');
  if (diagrams.length === 0) return '';
  const parts = diagrams.map((r) =>
    r.status === 'error'
      ? `<diagram name="${r.path}" error="${r.note ?? 'unavailable'}" />`
      : r.body ?? '');
  return [
    'The user attached the following project diagrams (Excalidraw) as context. Node/edge lines describe the drawn structure — treat labeled boxes as components and arrows as relationships/data flow.',
    '<referenced_diagrams>',
    ...parts,
    '</referenced_diagrams>',
  ].join('\n');
}

/** Format resolved notes as a prompt block (companion to formatReferencedFiles). */
export function formatKbNotes(resolved: ResolvedRef[]): string {
  const notes = resolved.filter((r) => r.kind === 'note');
  if (notes.length === 0) return '';
  const parts = notes.map((r) =>
    r.status === 'error'
      ? `<note slug="${r.path}" error="${r.note ?? 'unavailable'}" />`
      : `<note slug="${r.path}"${r.status === 'truncated' ? ' truncated="true"' : ''}>\n${r.body ?? ''}\n</note>`);
  return [
    'The user attached the following project knowledge-base notes as context.',
    '<referenced_notes>',
    ...parts,
    '</referenced_notes>',
  ].join('\n');
}

/**
 * Format resolved refs as the prompt block prepended to the user's message.
 * Returns `''` when there is nothing to say (no refs).
 */
export function formatReferencedFiles(resolved: ResolvedRef[]): string {
  if (resolved.length === 0) return '';
  const parts: string[] = [];
  for (const r of resolved) {
    if (r.kind === 'folder') {
      const attrs = [
        `path="${r.path}"`,
        `entries="${r.entryCount ?? 0}"`,
        ...(r.status === 'truncated' && r.note ? [`truncated="true" shown="${r.note}"`] : []),
      ].join(' ');
      parts.push(`<folder ${attrs}>\n${r.body ?? ''}\n</folder>`);
    } else if (r.status === 'error') {
      parts.push(`<file path="${r.path}" error="${r.note ?? 'unavailable'}" />`);
    } else {
      const attrs = [
        `path="${r.path}"`,
        `lines="${r.lines ?? 0}"`,
        ...(r.status === 'truncated' ? [`truncated="true" shown="${r.note ?? ''}"`] : []),
      ].join(' ');
      parts.push(`<file ${attrs}>\n${r.body ?? ''}\n</file>`);
    }
  }
  return [
    'The user attached the following workspace files/folders as context. Treat them as the current contents of those paths.',
    '<referenced_files>',
    ...parts,
    '</referenced_files>',
  ].join('\n');
}
