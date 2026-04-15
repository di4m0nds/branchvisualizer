import { useAppContext } from '@/store/AppContext';
import GraphCanvas from '@/components/GraphCanvas';
import CommitListView from '@/components/CommitListView';
import DetailPanel from '@/components/DetailPanel';
import FilesTab from './FilesTab';
import ReadmeTab from './ReadmeTab';
import PRsIssuesTab from './PRsIssuesTab';
import { cn } from '@/lib/utils';
import type { TabId, SplitLayout } from '@/types';

// ─── Tab config ────────────────────────────────────────────────────────────

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  shortLabel: string;
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
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
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
  return (
    <div className="flex items-center gap-0 border-b border-border flex-shrink-0 overflow-x-auto scrollbar-hide">
      {TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors flex-shrink-0',
            'border-b-2',
            activeTab === tab.id
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.icon}
          <span className={compact ? 'hidden sm:inline' : ''}>{tab.label}</span>
        </button>
      ))}
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
        <CommitListView />
      </div>
      {activeTab === 'files'  && <div className="absolute inset-0 flex flex-col"><FilesTab /></div>}
      {activeTab === 'readme' && <div className="absolute inset-0 flex flex-col"><ReadmeTab /></div>}
      {activeTab === 'prs'    && <div className="absolute inset-0 flex flex-col"><PRsIssuesTab /></div>}
    </div>
  );
}

// ─── Split pane ────────────────────────────────────────────────────────────

function SplitPane({
  paneIndex,
  className,
}: {
  paneIndex: 0 | 1 | 2 | 3;
  className?: string;
}) {
  const { state, dispatch } = useAppContext();
  const activeTab = state.paneTab[paneIndex];

  return (
    <div className={cn('flex flex-col min-h-0 overflow-hidden', className)}>
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
  const { activeTab, splitLayout, selectedNode, graphData } = state;

  // Determine if any visible pane is showing the commit list.
  // If so, the inline panel in CommitListView handles the detail.
  // If not, show the floating panel.
  const hasListTabVisible = (() => {
    if (!selectedNode) return false;
    if (splitLayout === 'single') return activeTab === 'list';
    const visibleCount = splitLayout === '4g' ? 4 : 2;
    return state.paneTab.slice(0, visibleCount).some(t => t === 'list');
  })();

  const showFloatingPanel = selectedNode && graphData && !hasListTabVisible;

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
          <>
            <SplitPane paneIndex={0} className="flex-1 min-w-0 border-r border-border" />
            <SplitPane paneIndex={1} className="flex-1 min-w-0" />
          </>
        )}

        {splitLayout === '2v' && (
          <div className="flex flex-col flex-1 min-h-0">
            <SplitPane paneIndex={0} className="flex-1 min-h-0 border-b border-border" />
            <SplitPane paneIndex={1} className="flex-1 min-h-0" />
          </div>
        )}

        {splitLayout === '4g' && (
          <div className="grid grid-cols-2 grid-rows-2 flex-1 min-h-0 overflow-hidden" style={{ height: '100%' }}>
            <SplitPane paneIndex={0} className="border-r border-b border-border min-h-0" />
            <SplitPane paneIndex={1} className="border-b border-border min-h-0" />
            <SplitPane paneIndex={2} className="border-r border-border min-h-0" />
            <SplitPane paneIndex={3} className="min-h-0" />
          </div>
        )}

        {/* Floating detail panel — only when no list tab is currently visible */}
        {showFloatingPanel && <DetailPanel mode="floating" />}
      </div>
    </div>
  );
}
