import { useAppContext } from '@/store/AppContext';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useState, useRef, useCallback } from 'react';
import GraphCanvas from '@/components/GraphCanvas';
import CommitListView from '@/components/CommitListView';
import DetailPanel from '@/components/DetailPanel';
import FilesTab from './FilesTab';
import ReadmeTab from './ReadmeTab';
import PRsIssuesTab from './PRsIssuesTab';
import ReleasesDeploymentsTab from './ReleasesDeploymentsTab';
import CIStatusTab from './CIStatusTab';
import HotspotsTab from './HotspotsTab';
import ComparePanel, { ComparePanelLocked } from './ComparePanel';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Capability, TabId, SplitLayout } from '@/types';

// ─── Tab config ────────────────────────────────────────────────────────────

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  shortLabel: string;
  /** Capability required to enable this tab. Undefined = always accessible. */
  requires?: Capability;
}

const TABS: TabDef[] = [
  {
    id: 'graph',
    label: 'Graph',
    shortLabel: 'Graph',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="3" cy="3" r="1.5"/><circle cx="3" cy="8" r="1.5"/>
        <circle cx="3" cy="13" r="1.5"/><circle cx="9" cy="5" r="1.5"/>
        <circle cx="9" cy="11" r="1.5"/><circle cx="13" cy="8" r="1.5"/>
        <path stroke="currentColor" strokeWidth="1" fill="none"
          d="M4.5 3.3 7.5 4.7M4.5 7.6 7.5 5.4M4.5 12.5 7.5 11.5M10.5 5.4 12 7M10.5 10.5 12 8.5"/>
      </svg>
    ),
  },
  {
    id: 'list',
    label: 'Commits',
    shortLabel: 'Commits',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <rect x="5" y="3.5" width="9" height="1.5" rx="0.75"/>
        <rect x="5" y="7.25" width="9" height="1.5" rx="0.75"/>
        <rect x="5" y="11" width="9" height="1.5" rx="0.75"/>
        <circle cx="2.5" cy="4.25" r="1.25"/><circle cx="2.5" cy="8" r="1.25"/>
        <circle cx="2.5" cy="11.75" r="1.25"/>
      </svg>
    ),
  },
  {
    id: 'files',
    label: 'Files',
    shortLabel: 'Files',
    requires: 'read:files',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/>
      </svg>
    ),
  },
  {
    id: 'readme',
    label: 'README',
    shortLabel: 'README',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25ZM7.25 8a.75.75 0 0 1-.22.53l-2.25 2.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L5.44 8 3.72 6.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z"/>
      </svg>
    ),
  },
  {
    id: 'prs',
    label: 'PRs & Issues',
    shortLabel: 'PRs',
    requires: 'read:files',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
      </svg>
    ),
  },
  {
    id: 'releases',
    label: 'Releases',
    shortLabel: 'Releases',
    requires: 'read:files',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/>
      </svg>
    ),
  },
  {
    id: 'ci',
    label: 'CI',
    shortLabel: 'CI',
    requires: 'compare:commits',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/>
      </svg>
    ),
  },
  {
    id: 'hotspots',
    label: 'Hotspots',
    shortLabel: 'Hot',
    requires: 'read:files',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8.75 1a.75.75 0 0 0-1.352-.46C5.6 3.16 5.05 5.07 5.05 6.75c0 .96.2 1.87.56 2.69A4.25 4.25 0 1 0 8.75 1zM8 13.5a2.75 2.75 0 0 1-1.95-4.7c.26.7.65 1.33 1.15 1.85.13.14.32.2.5.16a.5.5 0 0 0 .38-.44C8.2 9.24 8.75 7.8 9.5 6.77c.18.57.28 1.17.28 1.8A2.75 2.75 0 0 1 8 13.5z"/>
      </svg>
    ),
  },
];

// ─── Split layout icons ────────────────────────────────────────────────────

// Single pane – one full rectangle
function IconSingle() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1"/>
    </svg>
  );
}

// 2-pane left | right (vertical divider)
// Rotate the "rows" base shape 90° → becomes columns
function IconSplitColumns() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="1"   y="1.5" width="4" height="9" rx="0.8"/>
      <rect x="7"   y="1.5" width="4" height="9" rx="0.8"/>
    </svg>
  );
}

// 2-pane top / bottom (horizontal divider)
// Base shape – two stacked rows
function IconSplitRows() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="1.5" y="1"   width="9" height="4" rx="0.8"/>
      <rect x="1.5" y="7"   width="9" height="4" rx="0.8"/>
    </svg>
  );
}

// 4-grid – same columns icon concept extended to 2×2
function IconGrid4() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="1" y="1" width="4" height="4" rx="0.7"/>
      <rect x="7" y="1" width="4" height="4" rx="0.7"/>
      <rect x="1" y="7" width="4" height="4" rx="0.7"/>
      <rect x="7" y="7" width="4" height="4" rx="0.7"/>
    </svg>
  );
}

// ─── Resize handle ────────────────────────────────────────────────────────

interface ResizeHandleProps {
  direction: 'h' | 'v'; // h = left|right drag, v = top|bottom drag
  containerRef: React.RefObject<HTMLDivElement | null>;
  size: number; // current first-pane percentage
  onSizeChange: (newSize: number) => void;
}

function ResizeHandle({ direction, containerRef, size, onSizeChange }: ResizeHandleProps) {
  const isDragging = useRef(false);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(size);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startPosRef.current = direction === 'h' ? e.clientX : e.clientY;
    startSizeRef.current = size;

    const onMouseMove = (me: MouseEvent) => {
      if (!isDragging.current) return;
      const container = containerRef.current;
      if (!container) return;
      const containerSize = direction === 'h' ? container.offsetWidth : container.offsetHeight;
      const delta = (direction === 'h' ? me.clientX : me.clientY) - startPosRef.current;
      const newSize = Math.min(80, Math.max(20, startSizeRef.current + (delta / containerSize) * 100));
      onSizeChange(newSize);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [direction, containerRef, size, onSizeChange]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={cn(
        'flex-shrink-0 group relative flex items-center justify-center',
        'bg-border/50 hover:bg-primary/40 active:bg-primary/60 transition-colors z-10',
        direction === 'h'
          ? 'w-1 cursor-col-resize hover:w-1.5 active:w-1.5'
          : 'h-1 cursor-row-resize hover:h-1.5 active:h-1.5',
      )}
      title="Drag to resize"
    >
      {/* Grab dots */}
      <div className={cn(
        'flex gap-0.5 opacity-0 group-hover:opacity-60 transition-opacity',
        direction === 'h' ? 'flex-col' : 'flex-row',
      )}>
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1 h-1 rounded-full bg-foreground" />
        ))}
      </div>
    </div>
  );
}

// ─── Single pane tab bar ───────────────────────────────────────────────────

function PaneTabBar({
  activeTab,
  onTabChange,
  compact = false,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  compact?: boolean;
}) {
  const { hasCapability } = useCapabilities();

  return (
    <div className="flex items-center gap-0 border-b border-border flex-shrink-0 overflow-x-auto scrollbar-hide">
      {TABS.map(tab => {
        const locked = !!tab.requires && !hasCapability(tab.requires);
        const btn = (
          <button
            key={tab.id}
            onClick={() => !locked && onTabChange(tab.id)}
            disabled={locked}
            aria-disabled={locked}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors flex-shrink-0',
              'border-b-2',
              locked
                ? 'border-transparent text-muted-foreground/40 opacity-50 cursor-not-allowed'
                : activeTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.icon}
            <span className={compact ? 'hidden sm:inline' : ''}>{tab.label}</span>
            {locked && (
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" className="opacity-50 ml-0.5">
                <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 3.5a2 2 0 1 1 4 0V6H6V4.5z"/>
              </svg>
            )}
          </button>
        );

        if (locked) {
          return (
            <Tooltip key={tab.id} content="Sign in to access" side="bottom">
              {btn}
            </Tooltip>
          );
        }
        return btn;
      })}
    </div>
  );
}

// ─── Direction / split toolbar ─────────────────────────────────────────────

function WorkspaceToolbar() {
  const { state, dispatch } = useAppContext();
  const { splitLayout, graphDirection, graphData } = state;

  if (!graphData) return null;

  const SPLITS: { id: SplitLayout; title: string; icon: React.ReactNode }[] = [
    { id: 'single', title: 'Single pane',           icon: <IconSingle /> },
    { id: '2h',     title: 'Split left / right',    icon: <IconSplitColumns /> },
    { id: '2v',     title: 'Split top / bottom',    icon: <IconSplitRows /> },
    { id: '4g',     title: '4-grid',                icon: <IconGrid4 /> },
  ];

  return (
    <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 border-b border-border bg-muted/10 flex-shrink-0 flex-wrap gap-y-1">
      {/* Direction toggle */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground hidden sm:inline select-none">Graph direction:</span>
        <div className="flex items-center gap-0.5 p-0.5 rounded border border-border bg-muted/30">
          <button
            onClick={() => dispatch({ type: 'SET_GRAPH_DIRECTION', direction: 'vertical' })}
            title="Vertical layout (top→bottom)"
            className={cn(
              'w-6 h-6 flex items-center justify-center rounded text-[10px] transition-colors',
              graphDirection === 'vertical'
                ? 'bg-accent text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="6" y1="1" x2="6" y2="11"/>
              <path d="M3 8l3 3 3-3"/>
              <line x1="2" y1="4" x2="10" y2="4"/>
            </svg>
          </button>
          <button
            onClick={() => dispatch({ type: 'SET_GRAPH_DIRECTION', direction: 'horizontal' })}
            title="Horizontal layout (left→right)"
            className={cn(
              'w-6 h-6 flex items-center justify-center rounded text-[10px] transition-colors',
              graphDirection === 'horizontal'
                ? 'bg-accent text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="6" x2="11" y2="6"/>
              <path d="M8 3l3 3-3 3"/>
              <line x1="4" y1="2" x2="4" y2="10"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="h-4 w-px bg-border hidden sm:block" />

      {/* Split layout */}
      <div className="flex items-center gap-0.5 p-0.5 rounded border border-border bg-muted/30">
        {SPLITS.map(s => (
          <button
            key={s.id}
            onClick={() => dispatch({ type: 'SET_SPLIT_LAYOUT', layout: s.id })}
            title={s.title}
            className={cn(
              'w-6 h-6 flex items-center justify-center rounded transition-colors',
              splitLayout === s.id
                ? 'bg-accent text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Tab content renderer ──────────────────────────────────────────────────

function TabContent({ activeTab }: { activeTab: TabId }) {
  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      {/* Graph and List are always mounted for state preservation */}
      <div className={cn('absolute inset-0', activeTab !== 'graph' && 'invisible pointer-events-none')}>
        <GraphCanvas />
      </div>
      <div className={cn('absolute inset-0 flex flex-col', activeTab !== 'list' && 'invisible pointer-events-none')}>
        <CommitListView isActive={activeTab === 'list'} />
      </div>
      {activeTab === 'files'    && <div className="absolute inset-0 flex flex-col"><FilesTab /></div>}
      {activeTab === 'readme'   && <div className="absolute inset-0 flex flex-col"><ReadmeTab /></div>}
      {activeTab === 'prs'      && <div className="absolute inset-0 flex flex-col"><PRsIssuesTab /></div>}
      {activeTab === 'releases' && <div className="absolute inset-0 flex flex-col"><ReleasesDeploymentsTab /></div>}
      {activeTab === 'ci'       && <div className="absolute inset-0 flex flex-col"><CIStatusTab /></div>}
      {activeTab === 'hotspots' && <div className="absolute inset-0 flex flex-col"><HotspotsTab /></div>}
    </div>
  );
}

// ─── Split pane ────────────────────────────────────────────────────────────

function SplitPane({
  paneIndex,
  className,
  style,
}: {
  paneIndex: 0 | 1 | 2 | 3;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { state, dispatch } = useAppContext();
  const activeTab = state.paneTab[paneIndex];

  return (
    <div className={cn('flex flex-col min-h-0 overflow-hidden', className)} style={style}>
      <PaneTabBar
        activeTab={activeTab}
        onTabChange={tab => dispatch({ type: 'SET_PANE_TAB', pane: paneIndex, tab })}
        compact
      />
      <TabContent activeTab={activeTab} />
    </div>
  );
}

// ─── Main TabWorkspace ─────────────────────────────────────────────────────

export default function TabWorkspace() {
  const { state, dispatch } = useAppContext();
  const { activeTab, splitLayout, selectedNode, selectedNodes, graphData } = state;
  const { hasCapability } = useCapabilities();

  // Resize state for split layouts (percentages of the first pane)
  const [splitH, setSplitH] = useState(50);   // 2h: left pane %
  const [splitV, setSplitV] = useState(50);   // 2v: top pane %
  const [gridCol, setGridCol] = useState(50); // 4g: left column %
  const [gridRow, setGridRow] = useState(50); // 4g: top row %

  const containerRef2h   = useRef<HTMLDivElement>(null);
  const containerRef2v   = useRef<HTMLDivElement>(null);
  const containerRef4g   = useRef<HTMLDivElement>(null);

  // Determine if any visible pane is showing the commit list.
  // If so, the inline panel in CommitListView handles the detail.
  // If not, show the floating panel.
  const hasListTabVisible = (() => {
    if (!selectedNode) return false;
    if (splitLayout === 'single') return activeTab === 'list';
    const visibleCount = splitLayout === '4g' ? 4 : 2;
    return state.paneTab.slice(0, visibleCount).some(t => t === 'list');
  })();

  // Show compare panel when exactly 2 nodes selected
  const showComparePanel = selectedNodes.length === 2 && graphData;
  // Show regular detail panel for single select or multi (>2) — not when compare panel is active
  const showFloatingPanel = selectedNode && graphData && !hasListTabVisible && selectedNodes.length !== 2;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Toolbar (direction + split controls) */}
      <WorkspaceToolbar />

      {/* Single pane: show unified tab bar */}
      {splitLayout === 'single' && (
        <PaneTabBar
          activeTab={activeTab}
          onTabChange={tab => dispatch({ type: 'SET_ACTIVE_TAB', tab })}
        />
      )}

      {/* Content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {splitLayout === 'single' && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden relative">
            <TabContent activeTab={activeTab} />
          </div>
        )}

        {splitLayout === '2h' && (
          <div ref={containerRef2h} className="flex flex-1 min-h-0 overflow-hidden">
            <SplitPane paneIndex={0} style={{ width: `${splitH}%` }} className="min-w-0 flex-shrink-0" />
            <ResizeHandle
              direction="h"
              containerRef={containerRef2h}
              size={splitH}
              onSizeChange={setSplitH}
            />
            <SplitPane paneIndex={1} className="flex-1 min-w-0" />
          </div>
        )}

        {splitLayout === '2v' && (
          <div ref={containerRef2v} className="flex flex-col flex-1 min-h-0">
            <SplitPane paneIndex={0} style={{ height: `${splitV}%` }} className="min-h-0 flex-shrink-0" />
            <ResizeHandle
              direction="v"
              containerRef={containerRef2v}
              size={splitV}
              onSizeChange={setSplitV}
            />
            <SplitPane paneIndex={1} className="flex-1 min-h-0" />
          </div>
        )}

        {splitLayout === '4g' && (
          <div
            ref={containerRef4g}
            className="flex flex-col flex-1 min-h-0 overflow-hidden"
          >
            {/* Top row */}
            <div className="flex min-h-0 flex-shrink-0" style={{ height: `${gridRow}%` }}>
              <SplitPane paneIndex={0} style={{ width: `${gridCol}%` }} className="min-w-0 min-h-0 flex-shrink-0" />
              <ResizeHandle
                direction="h"
                containerRef={containerRef4g}
                size={gridCol}
                onSizeChange={setGridCol}
              />
              <SplitPane paneIndex={1} className="flex-1 min-w-0 min-h-0" />
            </div>
            {/* Horizontal divider */}
            <ResizeHandle
              direction="v"
              containerRef={containerRef4g}
              size={gridRow}
              onSizeChange={setGridRow}
            />
            {/* Bottom row */}
            <div className="flex flex-1 min-h-0">
              <SplitPane paneIndex={2} style={{ width: `${gridCol}%` }} className="min-w-0 min-h-0 flex-shrink-0" />
              <ResizeHandle
                direction="h"
                containerRef={containerRef4g}
                size={gridCol}
                onSizeChange={setGridCol}
              />
              <SplitPane paneIndex={3} className="flex-1 min-w-0 min-h-0" />
            </div>
          </div>
        )}

        {/* Floating detail panel — only when no list tab is currently visible */}
        {showFloatingPanel && <DetailPanel mode="floating" />}

        {/* Compare panel — shown when exactly 2 nodes selected */}
        {showComparePanel && (
          hasCapability('compare:commits')
            ? <ComparePanel />
            : <ComparePanelLocked />
        )}
      </div>
    </div>
  );
}
