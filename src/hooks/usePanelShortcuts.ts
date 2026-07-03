// ─── IDE panel focus + maximize shortcuts ───────────────────────────────────
// Alt+1..7 focuses a specific IDE panel (sidebar / chat / terminal /
// workspace / plan / runtime / docs); Alt+F toggles maximize on the focused
// panel. Modeled on useFocusedPanelZoom.ts — window-scoped keydown listener
// that ignores form inputs so typing in the composer never triggers a
// shortcut. Alt is used (not Ctrl/Cmd) to avoid colliding with browser
// tab-switching and the existing Ctrl/Cmd = / - / 0 panel-zoom bindings.

import { useEffect } from 'react';
import { getFocusedPanel, setFocusedPanel, toggleMaximizedPanel, type PanelId } from './usePanelFocus';
import { showPanel } from './usePanelVisibility';

/** Digit key ('1'..'7') → panel id in fixed IDE reading order. */
const DIGIT_TO_PANEL: Record<string, PanelId> = {
  '1': 'sidebar',
  '2': 'chat',
  '3': 'terminal',
  '4': 'workspace',
  '5': 'plan',
  '6': 'runtime',
  '7': 'docs',
};

export function usePanelShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Alt-only: no Ctrl/Meta/Shift, otherwise the browser's menu-bar
      // acceleration or system shortcuts may claim it.
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

      // Never fire inside a form field or contenteditable — the composer,
      // the plan-view editor, plan comment inputs, etc.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

      // Alt+F → toggle maximize on the currently-focused panel (falls back to
      // chat, which is the store's default focused panel on load). Sidebar
      // isn't wrapped in a FocusablePanel by design (per user preference), so
      // maximizing it would just hide every other panel — skip it.
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        const target = getFocusedPanel() ?? 'chat';
        if (target === 'sidebar') return;
        toggleMaximizedPanel(target);
        return;
      }

      // Alt+1..6 → focus panel N. First ensure the target is visible (the
      // right column shows only one of workspace/plan/runtime at a time; the
      // sidebar/dock may be collapsed) — otherwise focusing an unmounted
      // panel produces the "blank screen on Alt+F" bug.
      const panel = DIGIT_TO_PANEL[e.key];
      if (!panel) return;
      e.preventDefault();
      showPanel(panel);
      setFocusedPanel(panel);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
