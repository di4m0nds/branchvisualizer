import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppDispatch } from '@/store/store';
import { useDrag } from '@/hooks/useDrag';
import type { CommitDetails } from '@/lib/github';
import type { GraphNode } from '@/types';
import PanelHeader from './PanelHeader';
import CommitDetailsBody from './CommitDetailsBody';

// ─── Single floating panel — portal-based, freely draggable ──────────────────

const PANEL_W = 320;

function getInitialPos() {
  const sw = typeof window !== 'undefined' ? window.innerWidth : 800;
  const sh = typeof window !== 'undefined' ? window.innerHeight : 600;
  if (sw < 540) {
    const estimatedH = Math.min(sh * 0.65, 480);
    return {
      x: Math.max(8, (sw - PANEL_W) / 2),
      y: Math.max(16, Math.round((sh - estimatedH) / 2)),
    };
  }
  return {
    x: Math.max(16, sw - PANEL_W - 16),
    y: 16,
  };
}

interface FloatingPanelProps {
  node: GraphNode;
  details: CommitDetails | null;
  detailsLoading: boolean;
}

export default function FloatingPanel({ node, details, detailsLoading }: FloatingPanelProps) {
  const dispatch = useAppDispatch();
  const [minimized, setMinimized] = useState(false);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 540;

  const { pos, onHandleMouseDown: onHeaderMouseDown } = useDrag(getInitialPos());
  const panelRef = useRef<HTMLDivElement>(null);

  const panelWidth = isMobile ? Math.min(PANEL_W, window.innerWidth - 16) : PANEL_W;
  const panelMaxH = isMobile ? `${window.innerHeight - 48}px` : 'calc(100vh - 32px)';

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        width: panelWidth,
        maxHeight: panelMaxH,
      }}
      className="flex flex-col rounded-xl border border-border bg-card/95 backdrop-blur-sm
                 shadow-2xl overflow-hidden"
    >
      <PanelHeader
        node={node}
        mode="floating"
        minimized={minimized}
        onMinimize={() => setMinimized(v => !v)}
        onClose={() => dispatch({ type: 'SELECT_NODE', node: null })}
        onDragHandleMouseDown={onHeaderMouseDown}
      />
      {!minimized && <CommitDetailsBody node={node} details={details} detailsLoading={detailsLoading} variant="floating" />}
    </div>
  );

  return createPortal(panel, document.body);
}
