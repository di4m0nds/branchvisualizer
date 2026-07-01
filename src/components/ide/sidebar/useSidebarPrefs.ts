// UI-only sidebar preferences (collapsed groups, show-archived, sort mode).
// Persisted directly to localStorage — this state has no cross-cutting reducer
// concerns, so keeping it out of the AppContext keeps blast radius small.

import { useCallback, useEffect, useState } from 'react';

const KEY = 'code-agent:sidebar_ui';

export type SortMode = 'recent' | 'name';

interface SidebarPrefs {
  collapsed: Record<string, boolean>;
  showArchived: boolean;
  sort: SortMode;
}

const DEFAULT_PREFS: SidebarPrefs = {
  collapsed: {},
  showArchived: false,
  sort: 'recent',
};

function loadPrefs(): SidebarPrefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<SidebarPrefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function useSidebarPrefs() {
  const [prefs, setPrefs] = useState<SidebarPrefs>(loadPrefs);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* quota */ }
  }, [prefs]);

  const toggleCollapsed = useCallback((projectId: string) => {
    setPrefs((p) => ({
      ...p,
      collapsed: { ...p.collapsed, [projectId]: !p.collapsed[projectId] },
    }));
  }, []);

  const setShowArchived = useCallback((v: boolean) => {
    setPrefs((p) => ({ ...p, showArchived: v }));
  }, []);

  const setSort = useCallback((mode: SortMode) => {
    setPrefs((p) => (p.sort === mode ? p : { ...p, sort: mode }));
  }, []);

  return {
    collapsed: prefs.collapsed,
    showArchived: prefs.showArchived,
    sort: prefs.sort,
    toggleCollapsed,
    setShowArchived,
    setSort,
  };
}
