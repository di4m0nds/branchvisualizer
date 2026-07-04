import { useAppSelector, useAppDispatch } from '@/store/store';
import type { GraphNode } from '@/types';
import PanelHeader from './detail/PanelHeader';
import CommitDetailsBody from './detail/CommitDetailsBody';
import FloatingPanel from './detail/FloatingPanel';
import MultiSelectFloatingPanel from './detail/MultiSelectFloatingPanel';
import { useCommitDetails } from './detail/useCommitDetails';

// ─── Exported component ───────────────────────────────────────────────────────

interface DetailPanelProps {
  mode?: 'floating' | 'inline';
  /** Optional node override — when provided, renders this node instead of state.selectedNode */
  node?: GraphNode;
}

export default function DetailPanel({ mode = 'floating', node: nodeProp }: DetailPanelProps) {
  const dispatch = useAppDispatch();
  const selectedNode = useAppSelector((s) => s.selectedNode);
  const selectedNodes = useAppSelector((s) => s.selectedNodes);
  const graphData = useAppSelector((s) => s.graphData);

  // For inline mode with explicit node prop (multi-select in CommitListView)
  const inlineNode = nodeProp ?? selectedNode;
  const { commitDetails, detailsLoading } = useCommitDetails(inlineNode);

  if (!graphData) return null;

  // ── Inline mode ─────────────────────────────────────────────────────────
  if (mode === 'inline') {
    if (!inlineNode) return null;
    return (
      <div className="w-full bg-card/40 border-b border-border/70">
        <PanelHeader
          node={inlineNode}
          mode="inline"
          minimized={false}
          onMinimize={() => { }}
          onClose={() => {
            if (nodeProp) {
              // Deselect this specific node from multi-selection
              dispatch({ type: 'TOGGLE_MULTI_SELECT', node: nodeProp });
            } else {
              dispatch({ type: 'SELECT_NODE', node: null });
            }
          }}
        />
        <CommitDetailsBody node={inlineNode} details={commitDetails} detailsLoading={detailsLoading} variant="inline" />
      </div>
    );
  }

  // ── Floating mode — multi-select accordion ──────────────────────────────
  if (selectedNodes.length > 1) {
    return <MultiSelectFloatingPanel nodes={selectedNodes} />;
  }

  // ── Floating mode — single select ────────────────────────────────────────
  if (!selectedNode) return null;
  return <FloatingPanel node={selectedNode} details={commitDetails} detailsLoading={detailsLoading} />;
}
