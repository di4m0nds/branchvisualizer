import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppDispatch } from '@/store/store';
import { useDrag } from '@/hooks/useDrag';
import type { GraphNode } from '@/types';
import AccordionItem from './AccordionItem';

// ─── Multi-select floating panel ─────────────────────────────────────────────

const PANEL_W = 340;

function getInitialPos() {
  const sw = typeof window !== 'undefined' ? window.innerWidth : 800;
  const sh = typeof window !== 'undefined' ? window.innerHeight : 600;
  if (sw < 540) {
    return { x: Math.max(8, (sw - PANEL_W) / 2), y: Math.max(16, Math.round(sh * 0.15)) };
  }
  return { x: Math.max(16, sw - PANEL_W - 16), y: 16 };
}

interface MultiSelectFloatingPanelProps {
  nodes: GraphNode[];
}

export default function MultiSelectFloatingPanel({ nodes }: MultiSelectFloatingPanelProps) {
  const dispatch = useAppDispatch();
  const [expandedSha, setExpandedSha] = useState<string | null>(null);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 540;

  const { pos, onHandleMouseDown: onHeaderMouseDown } = useDrag(getInitialPos());

  // When a new node is added to selection, expand it
  const prevNodeCount = useRef(nodes.length);
  useEffect(() => {
    if (nodes.length > prevNodeCount.current) {
      // A new node was added — expand it
      setExpandedSha(nodes[nodes.length - 1].commit.sha);
    }
    prevNodeCount.current = nodes.length;
  }, [nodes]);

  function handleToggle(sha: string) {
    setExpandedSha(prev => prev === sha ? null : sha);
  }

  function handleDeselect(node: GraphNode) {
    dispatch({ type: 'TOGGLE_MULTI_SELECT', node });
  }

  function handleClearAll() {
    dispatch({ type: 'SELECT_NODE', node: null });
  }

  const panelWidth = isMobile ? Math.min(PANEL_W, window.innerWidth - 16) : PANEL_W;
  const panelMaxH = isMobile ? `${window.innerHeight - 48}px` : 'calc(100vh - 32px)';

  const panel = (
    <div
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
      {/* Multi-select panel header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b border-border flex-shrink-0
                   cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onHeaderMouseDown}
      >
        <div className="flex-shrink-0 flex flex-col gap-[3px] pr-1 opacity-30">
          <div className="w-3 h-px bg-current rounded-full" />
          <div className="w-3 h-px bg-current rounded-full" />
          <div className="w-3 h-px bg-current rounded-full" />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">
          {nodes.length} commits selected
        </span>
        <span
          onMouseDown={e => e.stopPropagation()}
          className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer transition-colors px-1"
          onClick={handleClearAll}
        >
          clear all
        </span>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={handleClearAll}
          title="Close"
          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>

      {/* Accordion list */}
      <div className="flex-1 overflow-y-auto">
        {nodes.map(node => (
          <AccordionItem
            key={node.commit.sha}
            node={node}
            isExpanded={expandedSha === node.commit.sha}
            onToggle={() => handleToggle(node.commit.sha)}
            onDeselect={() => handleDeselect(node)}
          />
        ))}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
