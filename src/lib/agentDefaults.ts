// ─── Agent defaults for new sessions ─────────────────────────────────────────
// The access level + build mode a freshly-created IDE session starts with.
// Configured in the Settings panel; applied by IdeWorkspace.newSession().

import type { AccessLevel, BuildMode } from '@/types/session';

const KEY = 'code-agent:agent_defaults';

export interface AgentDefaults {
  accessLevel: AccessLevel;
  buildMode: BuildMode;
}

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  accessLevel: 'supervised',
  buildMode: 'direct',
};

export function loadAgentDefaults(): AgentDefaults {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_AGENT_DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_AGENT_DEFAULTS };
    return { ...DEFAULT_AGENT_DEFAULTS, ...(JSON.parse(raw) as Partial<AgentDefaults>) };
  } catch {
    return { ...DEFAULT_AGENT_DEFAULTS };
  }
}

export function saveAgentDefaults(d: AgentDefaults): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* quota */ }
}
