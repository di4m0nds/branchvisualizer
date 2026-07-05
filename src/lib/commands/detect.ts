// ─── Detection driver ────────────────────────────────────────────────────────
// Feeds the pure detector registry with real project files: root-level names
// from a shallow walk + manifest contents via the jailed reader. Results are
// cached in localStorage per project root (tiny — labels and command strings)
// and refreshed on demand.

import { invoke } from '@/lib/platform';
import { swallow } from '@/lib/log';
import { detectCommands, type DevCommand } from './detectors';

const KEY = 'code-agent:project_commands';

interface CacheBlob {
  [root: string]: { at: string; commands: DevCommand[] };
}

function readCache(): CacheBlob {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' ? (parsed as CacheBlob) : {};
  } catch (e) {
    swallow('commands', 'read cache')(e);
    return {};
  }
}

function writeCache(blob: CacheBlob): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(blob));
  } catch (e) {
    swallow('commands', 'persist cache')(e);
  }
}

export function cachedCommands(root: string): DevCommand[] | null {
  return readCache()[root]?.commands ?? null;
}

interface TreeEntryLite { path: string; name: string; isDir: boolean; depth: number }

/** Scan the project root and detect commands; caches the result. */
export async function scanProjectCommands(root: string): Promise<DevCommand[]> {
  // Depth-1 walk: manifests live at the root. (walk_tree skips dot-dirs at
  // depth 0, which is fine — every manifest we care about is a plain name.)
  const entries = await invoke<TreeEntryLite[]>('walk_tree', { root, maxDepth: 1 });
  const files = new Set(entries.filter((e) => !e.isDir && e.depth === 0).map((e) => e.name));
  const commands = await detectCommands(files, (name) =>
    invoke<string>('agent_read_file', { root, path: name }));
  const blob = readCache();
  // Keep the cache bounded: this project + at most 7 most-recent others.
  const others = Object.entries(blob)
    .filter(([k]) => k !== root)
    .sort(([, a], [, b]) => b.at.localeCompare(a.at))
    .slice(0, 7);
  writeCache(Object.fromEntries([[root, { at: new Date().toISOString(), commands }], ...others]));
  return commands;
}
