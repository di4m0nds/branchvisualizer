// ─── Runtime panel preferences ───────────────────────────────────────────────
// Plain localStorage helpers (mirrors useSidebarPrefs.ts): preferred engine +
// polling intervals for the Runtime Environment panel.

import { swallow } from '@/lib/log';
import type { ContainerEngine } from '@/types/runtime';

const ENGINE_KEY = 'code-agent:runtime_engine';
const INTERVALS_KEY = 'code-agent:runtime_intervals';

export function loadEngine(): ContainerEngine | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ENGINE_KEY);
    return raw === 'docker' || raw === 'podman' ? raw : null;
  } catch (e) {
    swallow('runtime', 'load engine pref')(e);
    return null;
  }
}

export function saveEngine(engine: ContainerEngine | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (engine) localStorage.setItem(ENGINE_KEY, engine);
    else localStorage.removeItem(ENGINE_KEY);
  } catch (e) {
    swallow('runtime', 'save engine pref')(e);
  }
}

export interface RuntimeIntervals {
  /** `ps -a` + compose refresh period. */
  psMs: number;
  /** Stats-stream buffer flush period. */
  statsMs: number;
  /** Logs-stream buffer flush period. */
  logsMs: number;
}

export const DEFAULT_INTERVALS: RuntimeIntervals = { psMs: 3000, statsMs: 1500, logsMs: 400 };

export function loadIntervals(): RuntimeIntervals {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_INTERVALS };
  try {
    const raw = localStorage.getItem(INTERVALS_KEY);
    if (!raw) return { ...DEFAULT_INTERVALS };
    const v = JSON.parse(raw) as Partial<RuntimeIntervals>;
    const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : d);
    return {
      psMs: num(v.psMs, DEFAULT_INTERVALS.psMs),
      statsMs: num(v.statsMs, DEFAULT_INTERVALS.statsMs),
      logsMs: num(v.logsMs, DEFAULT_INTERVALS.logsMs),
    };
  } catch (e) {
    swallow('runtime', 'load intervals')(e);
    return { ...DEFAULT_INTERVALS };
  }
}

export function saveIntervals(iv: RuntimeIntervals): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(INTERVALS_KEY, JSON.stringify(iv));
  } catch (e) {
    swallow('runtime', 'save intervals')(e);
  }
}

/** Agent sandbox containers (src-tauri/src/sandbox.rs naming scheme). */
export function isSandboxContainer(name: string): boolean {
  return name.startsWith('ca-sbx-');
}
