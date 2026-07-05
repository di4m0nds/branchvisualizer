// ─── Cost / context budget preferences ───────────────────────────────────────
// App-global levers that bound token spend per turn. Read at REQUEST time by
// the agent loop (no store subscription needed) and edited in
// Settings → Models & Cost. Same localStorage pattern as agentDefaults.ts.

import { swallow } from '../log';
import { MODEL_TOOL_RESULT_CAP } from './agentUtils';

const KEY = 'code-agent:cost_prefs';

export interface CostPrefs {
  /** Send only the last N conversation messages per turn. 0 = all (default). */
  historyWindow: number;
  /** Character cap for each tool_result sent back to the model. */
  toolResultCap: number;
  /** max_tokens for the model response. */
  maxOutputTokens: number;
  /** Transient-error retries per model call (429/5xx/network). */
  maxRetries: number;
  /** Hard wall-clock cap for one model call, ms. 0 = no timeout. */
  turnTimeoutMs: number;
  /** ≈USD cap per session — turns stop (resumable) once exceeded. null = off. */
  sessionCostLimitUSD: number | null;
  /** ≈USD cap per calendar day across all sessions. null = off. */
  dailyCostLimitUSD: number | null;
}

export const DEFAULT_COST_PREFS: CostPrefs = {
  historyWindow: 0,
  toolResultCap: MODEL_TOOL_RESULT_CAP,
  maxOutputTokens: 64000,
  maxRetries: 2,
  turnTimeoutMs: 0,
  sessionCostLimitUSD: null,
  dailyCostLimitUSD: null,
};

export function loadCostPrefs(): CostPrefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_COST_PREFS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_COST_PREFS };
    // Spread-merge so adding fields later stays backward compatible.
    return { ...DEFAULT_COST_PREFS, ...(JSON.parse(raw) as Partial<CostPrefs>) };
  } catch (e) {
    swallow('costPrefs', 'load')(e);
    return { ...DEFAULT_COST_PREFS };
  }
}

export function saveCostPrefs(prefs: CostPrefs): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch (e) {
    swallow('costPrefs', 'persist')(e);
  }
}

/** Apply the history window: keep the last N messages (0 = all). Never drops
 *  below the final message (the current turn). */
export function applyHistoryWindow<T>(messages: T[], window: number): T[] {
  if (window <= 0 || messages.length <= window) return messages;
  return messages.slice(-window);
}
