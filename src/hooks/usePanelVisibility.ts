// ─── Show-panel event bus ───────────────────────────────────────────────────
// Ensures a panel is actually MOUNTED before it can be focused/maximized.
// Focus-only was insufficient: pressing Alt+6 (focus runtime) while the right
// column showed the workspace canvas set `focused = 'runtime'` in the store,
// but the runtime `FocusablePanel` wasn't mounted — a subsequent Alt+F to
// maximize hid every other panel via `hiddenByOther` and there was nothing to
// show fullscreen, leaving a blank screen.
//
// IdeWorkspace registers a handler that translates a PanelId into whatever
// layout mutation makes that panel visible:
//   • 'sidebar'   → sidebarCollapsed = false
//   • 'chat'      → always mounted; no-op
//   • 'terminal'  → dockCollapsed = false
//   • 'workspace' | 'plan' | 'runtime' → rightView = that id
// Callers (shortcuts, cross-panel affordances) fire `showPanel(id)` and let
// the handler do the right thing.

import type { PanelId } from './usePanelFocus';

type Handler = (id: PanelId) => void;

let current: Handler | null = null;

/** IdeWorkspace registers how to make each panel visible; returns an
 *  unregister fn so a stale closure never overwrites the fresh one. */
export function registerShowPanel(fn: Handler): () => void {
  current = fn;
  return () => {
    if (current === fn) current = null;
  };
}

/** Ask the IDE to make `id` visible. Returns false when the IDE isn't mounted. */
export function showPanel(id: PanelId): boolean {
  if (!current) return false;
  current(id);
  return true;
}
