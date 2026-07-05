// ─── Project asset store ─────────────────────────────────────────────────────
// Durable, project-scoped storage used by the knowledge base, diagrams, and
// goal-run state. Desktop: files on disk under the project's asset root
// (`<root>/.code-agent` for local projects, app-data for GitHub-source ones)
// via the jailed Rust `asset_*` commands. Browser: a degraded localStorage
// fallback (soft-capped — bulky features disable version history there).

import type { Project } from '../types/session';
import { invoke, isTauri } from './platform';

export interface AssetEntry {
  name: string;
  /** Path relative to the asset root (usable directly in read/write/remove). */
  path: string;
  isDir: boolean;
  sizeBytes: number;
  modifiedAt?: number;
}

export interface ProjectStore {
  /** True when backed by real files (desktop). Version history and other
   *  disk-hungry features should be gated on this. */
  readonly durable: boolean;
  list(sub: string): Promise<AssetEntry[]>;
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Absolute asset root on disk (desktop only; null in the browser). Lets the
   *  UI show "stored at …" and lets prompts point CLI agents at real files. */
  root(): Promise<string | null>;
}

// ─── Desktop (Tauri) backend ────────────────────────────────────────────────

const rootCache = new Map<string, Promise<string>>();

function assetRoot(project: Project): Promise<string> {
  let cached = rootCache.get(project.id);
  if (!cached) {
    cached = invoke<string>('asset_root', {
      projectRoot: project.source === 'local' ? project.path : null,
      projectId: project.id,
    });
    // Don't cache failures — a transient error would poison every later call.
    cached.catch(() => rootCache.delete(project.id));
    rootCache.set(project.id, cached);
  }
  return cached;
}

class TauriProjectStore implements ProjectStore {
  readonly durable = true;
  constructor(private project: Project) {}

  async list(sub: string): Promise<AssetEntry[]> {
    const dir = await assetRoot(this.project);
    return invoke<AssetEntry[]>('asset_list', { dir, subpath: sub });
  }
  async read(path: string): Promise<string | null> {
    const dir = await assetRoot(this.project);
    return invoke<string | null>('asset_read', { dir, path });
  }
  async write(path: string, content: string): Promise<void> {
    const dir = await assetRoot(this.project);
    await invoke('asset_write', { dir, path, content });
    if (this.project.source === 'local') void ensureGitignore(this.project);
  }
  async remove(path: string): Promise<void> {
    const dir = await assetRoot(this.project);
    await invoke('asset_delete', { dir, path });
  }
  async rename(from: string, to: string): Promise<void> {
    const dir = await assetRoot(this.project);
    await invoke('asset_rename', { dir, from, to });
  }
  async root(): Promise<string | null> {
    return assetRoot(this.project);
  }
}

/** Copy a user-dialog-picked absolute file into the project's asset tree. */
export async function importAsset(project: Project, srcAbsPath: string, dest: string): Promise<void> {
  const dir = await assetRoot(project);
  await invoke('asset_import', { dir, srcAbsPath, dest });
}

/** Write export content to a user-dialog-picked absolute path (save dialog). */
export async function writeExport(destAbsPath: string, content: string, base64 = false): Promise<void> {
  await invoke('write_export', { destAbsPath, content, base64 });
}

// One-time `.gitignore` hygiene: `.code-agent/` holds app data (notes,
// diagrams, goal state) that most users won't want committed. Opt-out is
// remembered so removing the line sticks.
const GITIGNORE_OPTOUT_KEY = 'code-agent:asset_gitignore_optout';
const gitignoreChecked = new Set<string>();

async function ensureGitignore(project: Project): Promise<void> {
  if (gitignoreChecked.has(project.id)) return;
  gitignoreChecked.add(project.id);
  try {
    if (localStorage.getItem(GITIGNORE_OPTOUT_KEY) === 'true') return;
  } catch { /* storage unavailable */ }
  try {
    const existing = await invoke<string>('agent_read_file', {
      root: project.path, path: '.gitignore',
    }).catch(() => '');
    if (/^\.code-agent\/?$/m.test(existing)) return;
    const next = existing
      ? `${existing.replace(/\n?$/, '\n')}\n# code-agent app data (notes, diagrams, goal state)\n.code-agent/\n`
      : `# code-agent app data (notes, diagrams, goal state)\n.code-agent/\n`;
    await invoke('agent_write_file', { root: project.path, path: '.gitignore', content: next });
  } catch {
    // Non-fatal: a read-only tree just means the user manages .gitignore themselves.
  }
}

// ─── Browser fallback ───────────────────────────────────────────────────────
// localStorage keys `code-agent:asset:<projectId>:<path>`. Soft-capped per
// project so diagram JSON can't blow the ~5MB origin quota.

const BROWSER_SOFT_CAP_BYTES = 512 * 1024;

class BrowserProjectStore implements ProjectStore {
  readonly durable = false;
  private prefix: string;
  constructor(project: Project) {
    this.prefix = `code-agent:asset:${project.id}:`;
  }

  private keys(): string[] {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.prefix)) out.push(k);
    }
    return out;
  }

  async list(sub: string): Promise<AssetEntry[]> {
    const norm = sub.replace(/\/+$/, '');
    const seen = new Map<string, AssetEntry>();
    for (const k of this.keys()) {
      const rel = k.slice(this.prefix.length);
      if (norm && !rel.startsWith(`${norm}/`)) continue;
      const remainder = norm ? rel.slice(norm.length + 1) : rel;
      const [head, ...rest] = remainder.split('/');
      if (!head) continue;
      const isDir = rest.length > 0;
      const path = norm ? `${norm}/${head}` : head;
      if (!seen.has(head) || !isDir) {
        seen.set(head, {
          name: head,
          path,
          isDir,
          sizeBytes: isDir ? 0 : (localStorage.getItem(k)?.length ?? 0),
        });
      }
    }
    return [...seen.values()].sort(
      (a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name),
    );
  }
  async read(path: string): Promise<string | null> {
    return localStorage.getItem(this.prefix + path);
  }
  async write(path: string, content: string): Promise<void> {
    const used = this.keys().reduce((n, k) => n + (localStorage.getItem(k)?.length ?? 0), 0);
    const prev = localStorage.getItem(this.prefix + path)?.length ?? 0;
    if (used - prev + content.length > BROWSER_SOFT_CAP_BYTES) {
      throw new Error(
        'Browser storage cap reached for this project — use the desktop app for larger notes/diagrams.',
      );
    }
    localStorage.setItem(this.prefix + path, content);
  }
  async remove(path: string): Promise<void> {
    localStorage.removeItem(this.prefix + path);
    // Directory remove: drop every key under the path.
    for (const k of this.keys()) {
      if (k.startsWith(`${this.prefix}${path}/`)) localStorage.removeItem(k);
    }
  }
  async rename(from: string, to: string): Promise<void> {
    const v = localStorage.getItem(this.prefix + from);
    if (v !== null) {
      localStorage.setItem(this.prefix + to, v);
      localStorage.removeItem(this.prefix + from);
    }
  }
  async root(): Promise<string | null> {
    return null;
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

const storeCache = new Map<string, ProjectStore>();

export function getProjectStore(project: Project): ProjectStore {
  let store = storeCache.get(project.id);
  if (!store) {
    store = isTauri() ? new TauriProjectStore(project) : new BrowserProjectStore(project);
    storeCache.set(project.id, store);
  }
  return store;
}
