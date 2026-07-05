// Installs the IDE-scoped zoom hotkeys: Ctrl/Cmd + '='/'+' / '-' / '0' zoom the
// currently focused panel only (chat/terminal/sidebar/plan scale their content;
// the workspace delegates to the graph's own viewport zoom via the callback).
// Escape restores a maximized panel. Global body zoom is suspended on /ide so
// these are the only zoom keys in play there.

import { useEffect } from 'react';
import {
  getFocusedPanel, bumpPanelZoom, resetPanelZoom,
  getMaximizedPanel, setMaximizedPanel,
  PANEL_ZOOM_STEP, type PanelId,
} from './usePanelFocus';

// Panels where Ctrl±/0 must not write a store zoom: the canvas (Excalidraw)
// has its own native zoom — storing a scale here would double-zoom or mislead.
// (The workspace is handled separately: it delegates to the graph viewport.)
const NATIVE_ZOOM_PANELS: ReadonlySet<PanelId> = new Set<PanelId>(['canvas']);

type ZoomCmd = 'in' | 'out' | 'reset';

/** @param onWorkspaceZoom handles zoom when the workspace panel is focused
 *  (delegated to the graph viewport by the caller). */
export function useFocusedPanelZoom(onWorkspaceZoom?: (cmd: ZoomCmd) => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape restores a maximized panel (unless typing / the graph handles it).
      if (e.key === 'Escape' && getMaximizedPanel()) {
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        setMaximizedPanel(null);
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;
      let cmd: ZoomCmd | null = null;
      if (e.key === '=' || e.key === '+') cmd = 'in';
      else if (e.key === '-' || e.key === '_') cmd = 'out';
      else if (e.key === '0') cmd = 'reset';
      if (!cmd) return;

      const panel = getFocusedPanel();
      if (!panel) return;
      e.preventDefault();

      if (panel === 'workspace') {
        onWorkspaceZoom?.(cmd);
        return;
      }
      // Let panels with native zoom (Excalidraw) handle Ctrl± themselves.
      if (NATIVE_ZOOM_PANELS.has(panel)) return;
      applyPanelZoom(panel, cmd);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onWorkspaceZoom]);
}

function applyPanelZoom(panel: PanelId, cmd: ZoomCmd): void {
  if (cmd === 'reset') resetPanelZoom(panel);
  else bumpPanelZoom(panel, cmd === 'in' ? PANEL_ZOOM_STEP : -PANEL_ZOOM_STEP);
}
