// Wraps an IDE zone so it participates in the focus + maximize system. Clicking
// or tab-focusing anywhere inside marks the panel focused (drives scoped zoom).
// When maximized, renders a full-screen overlay reusing the same DOM node — so
// xterm PTYs and the graph canvas survive maximize/restore. The visible
// maximize/restore control lives inside each panel's own header via the small
// `PanelMaximizeButton` component, so it never floats over other controls.

import { Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CSS_ZOOM_EXEMPT, useIsFocused, useMaximizedPanel, usePanelZoom,
  setFocusedPanel, toggleMaximizedPanel, type PanelId,
} from '@/hooks/usePanelFocus';

interface Props {
  id: PanelId;
  className?: string;
  /** Show the focus ring (default true). */
  ring?: boolean;
  /** Apply the panel's zoom scale to its content via CSS `zoom`. */
  applyScale?: boolean;
  children: React.ReactNode;
}

export default function FocusablePanel({
  id, className, ring = true, applyScale = false, children,
}: Props) {
  const focused = useIsFocused(id);
  const maximized = useMaximizedPanel();
  const scale = usePanelZoom(id);

  const isMax = maximized === id;
  const hiddenByOther = maximized !== null && !isMax;

  return (
    <div
      data-panel={id}
      onMouseDownCapture={() => setFocusedPanel(id)}
      onFocusCapture={() => setFocusedPanel(id)}
      tabIndex={-1}
      className={cn(
        'group relative flex flex-col min-h-0 min-w-0 outline-none',
        ring && focused && !isMax && 'ring-2 ring-inset ring-primary/40 rounded-sm z-10',
        isMax && 'fixed inset-0 z-50 bg-background',
        hiddenByOther && 'hidden',
        className,
      )}
    >
      {/* Hard guard: canvas-backed panels must never get CSS zoom, even if a
          future call site passes applyScale. */}
      {applyScale && scale !== 1 && !CSS_ZOOM_EXEMPT.has(id) ? (
        <div
          className="flex flex-col flex-1 min-h-0 min-w-0"
          style={{ zoom: scale } as React.CSSProperties}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/**
 * Small, static maximize/restore button for a panel's own header. Drop it
 * anywhere in the panel's chrome — sits alongside the panel's other controls
 * rather than floating over them.
 */
export function PanelMaximizeButton({
  id, className,
}: {
  id: PanelId;
  className?: string;
}) {
  const maximized = useMaximizedPanel();
  const isMax = maximized === id;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); toggleMaximizedPanel(id); }}
      title={isMax ? 'Restore panel (Esc)' : 'Maximize panel'}
      aria-label={isMax ? 'Restore panel' : 'Maximize panel'}
      className={cn(
        'p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors',
        className,
      )}
    >
      {isMax ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
    </button>
  );
}
