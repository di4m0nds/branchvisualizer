import { useAppDispatch, useAppSelector } from '@/store/store';
import { memo, useState, useRef } from 'react';
import GraphCanvas from '@/components/GraphCanvas';
import CommitListView from '@/components/CommitListView';
import DetailPanel from '@/components/DetailPanel';
import FilesTab from './FilesTab';
import ReadmeTab from './ReadmeTab';
import PRsIssuesTab from './PRsIssuesTab';
import ReleasesDeploymentsTab from './ReleasesDeploymentsTab';
import CIStatusTab from './CIStatusTab';
import LocalFilesTab from './LocalFilesTab';
import LocalReadmeTab from './LocalReadmeTab';
import LocalDocsTab from './LocalDocsTab';
import { cn } from '@/lib/utils';
import { ResizeHandle } from './ResizeHandle';
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
    id: 'docs',
    label: 'Docs',
    shortLabel: 'Docs',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 2.75C2 1.784 2.784 1 3.75 1h6.5c.966 0 1.75.784 1.75 1.75V13a1 1 0 0 1-1 1H4.75c-.69 0-1.25.56-1.25 1.25 0 .414.336.75.75.75h8.25a.75.75 0 0 1 0 1.5H4.25A2.25 2.25 0 0 1 2 15.25V2.75ZM5.25 4a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5h-5Zm0 3a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5h-5Z"/>
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
  {
    id: 'releases',
    label: 'Releases',
    shortLabel: 'Releases',
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
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/>
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

// Tabs available for local git repositories. PRs/Releases/CI stay GitHub-only —
// no equivalent from a local repo. Files/README/Docs use the Rust walk + fs
// commands (see LocalFilesTab / LocalReadmeTab / LocalDocsTab).
const LOCAL_TAB_IDS: TabId[] = ['graph', 'list', 'files', 'readme', 'docs'];

function PaneTabBar({
  activeTab,
  onTabChange,
  compact = false,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  compact?: boolean;
}) {
  const source = useAppSelector((s) => s.source);
  const tabs = source === 'local' ? TABS.filter(t => LOCAL_TAB_IDS.includes(t.id)) : TABS;
  return (
    <div className="flex items-center gap-0 border-b border-border flex-shrink-0 overflow-x-auto scrollbar-hide">
      {tabs.map(tab => (
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
  const dispatch = useAppDispatch();
  const splitLayout = useAppSelector((s) => s.splitLayout);
  const graphDirection = useAppSelector((s) => s.graphDirection);
  const graphData = useAppSelector((s) => s.graphData);
  const showCheckpoints = useAppSelector((s) => s.showCheckpoints);

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

      {/* Checkpoint visibility — t3 checkpoint commits are hidden by default. */}
      <button
        onClick={() => dispatch({ type: 'SET_SHOW_CHECKPOINTS', show: !showCheckpoints })}
        title={showCheckpoints ? 'Hide t3 checkpoint commits' : 'Show t3 checkpoint commits'}
        className={cn(
          'flex items-center gap-1.5 h-6 px-2 rounded border text-[10px] font-medium transition-colors',
          showCheckpoints
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground',
        )}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="2.2" />
          <line x1="6" y1="1" x2="6" y2="3.8" />
          <line x1="6" y1="8.2" x2="6" y2="11" />
        </svg>
        <span className="hidden sm:inline">Checkpoints</span>
      </button>

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
  const source = useAppSelector((s) => s.source);
  const isLocal = source === 'local';
  // PRs/Releases/CI are GitHub-only; hide with a note if opened in local mode.
  const githubOnlyIssue = isLocal && (['prs', 'releases', 'ci', 'docs'].indexOf(activeTab) === -1)
    ? false
    : isLocal && (['prs', 'releases', 'ci'] as TabId[]).includes(activeTab);
  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      {/* Graph and List are always mounted for state preservation */}
      <div className={cn('absolute inset-0', activeTab !== 'graph' && 'invisible pointer-events-none')}>
        <GraphCanvas />
      </div>
      <div className={cn('absolute inset-0 flex flex-col', activeTab !== 'list' && 'invisible pointer-events-none')}>
        <CommitListView isActive={activeTab === 'list'} />
      </div>
      {githubOnlyIssue && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          This view is only available for GitHub repositories.
        </div>
      )}
      {activeTab === 'files'    && (isLocal
        ? <div className="absolute inset-0 flex flex-col"><LocalFilesTab /></div>
        : <div className="absolute inset-0 flex flex-col"><FilesTab /></div>)}
      {activeTab === 'readme'   && (isLocal
        ? <div className="absolute inset-0 flex flex-col"><LocalReadmeTab /></div>
        : <div className="absolute inset-0 flex flex-col"><ReadmeTab /></div>)}
      {activeTab === 'docs'     && (
        <div className="absolute inset-0 flex flex-col">
          {isLocal ? <LocalDocsTab /> : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Docs viewer is available for local repositories.
            </div>
          )}
        </div>
      )}
      {!isLocal && activeTab === 'prs'      && <div className="absolute inset-0 flex flex-col"><PRsIssuesTab /></div>}
      {!isLocal && activeTab === 'releases' && <div className="absolute inset-0 flex flex-col"><ReleasesDeploymentsTab /></div>}
      {!isLocal && activeTab === 'ci'       && <div className="absolute inset-0 flex flex-col"><CIStatusTab /></div>}
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
  const dispatch = useAppDispatch();
  const activeTab = useAppSelector((s) => s.paneTab[paneIndex]);

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

// Memoized: mounted alongside the chat, and its parent (IdeWorkspace)
// re-renders on every streamed token — with no props, memo makes those
// parent-driven re-renders free. Store changes still flow via selectors.
export default memo(function TabWorkspace() {
  const dispatch = useAppDispatch();
  const activeTab = useAppSelector((s) => s.activeTab);
  const splitLayout = useAppSelector((s) => s.splitLayout);
  const selectedNode = useAppSelector((s) => s.selectedNode);
  const graphData = useAppSelector((s) => s.graphData);
  const paneTab = useAppSelector((s) => s.paneTab);

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
    return paneTab.slice(0, visibleCount).some(t => t === 'list');
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
      </div>
    </div>
  );
});
