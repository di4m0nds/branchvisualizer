import { ChevronDown, ChevronRight, GitBranch, GitGraph, ClipboardList, Boxes, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/store/AppContext';
import { PanelMaximizeButton } from './FocusablePanel';
import type { PanelId } from '@/hooks/usePanelFocus';

// The BranchVisualizer's own configuration header, docked at the top of the
// right column — separate from the agent config so each pane keeps its own
// controls. Collapses to a single line. TabWorkspace keeps its internal
// graph/split/direction toolbar; this strip owns repo identity + collapse, and
// the Canvas ↔ Plan view switch for the right column.

export type RightView = 'workspace' | 'plan' | 'runtime' | 'docs';

export default function BvConfigStrip({
  collapsed, onToggle, view, onViewChange, hasPlan,
}: {
  collapsed: boolean;
  onToggle: () => void;
  view: RightView;
  onViewChange: (v: RightView) => void;
  /** Show a dot on the Plan tab when the session has a plan to review. */
  hasPlan?: boolean;
}) {
  const { state } = useAppContext();
  const { repoInfo, branches, tags, allCommits } = state;

  return (
    <div className="flex-shrink-0 border-b border-border bg-muted/10">
      <div className="flex items-center gap-2 px-3 h-9">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          title={collapsed ? 'Expand repository panel' : 'Collapse repository panel'}
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {/* Canvas ↔ Plan switch */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-background/60 border border-border/60">
          <SwitchButton active={view === 'workspace'} onClick={() => onViewChange('workspace')} title="Repository canvas">
            <GitGraph className="w-3 h-3" />
            <span className="hidden md:inline">Canvas</span>
          </SwitchButton>
          <SwitchButton
            active={view === 'plan'}
            emphasize={!!hasPlan && view !== 'plan'}
            onClick={() => onViewChange('plan')}
            title={hasPlan && view !== 'plan' ? 'A plan is ready to review' : 'Implementation plan'}
          >
            <span className="relative">
              <ClipboardList className="w-3 h-3" />
              {hasPlan && view !== 'plan' && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </span>
            <span className="hidden md:inline">Plan</span>
          </SwitchButton>
          <SwitchButton active={view === 'runtime'} onClick={() => onViewChange('runtime')} title="Container runtime">
            <Boxes className="w-3 h-3" />
            <span className="hidden md:inline">Runtime</span>
          </SwitchButton>
          <SwitchButton active={view === 'docs'} onClick={() => onViewChange('docs')} title="Repository documentation">
            <BookOpen className="w-3 h-3" />
            <span className="hidden md:inline">Docs</span>
          </SwitchButton>
        </div>

        {/* Collapsing hides the repo identity + counts. Only shown in Canvas. */}
        {view === 'workspace' && repoInfo && !collapsed && (
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-foreground/80 truncate">
            <GitBranch className="w-3 h-3 text-muted-foreground" />
            <span className="truncate">{repoInfo.fullName}</span>
          </span>
        )}
        {view === 'workspace' && repoInfo && !collapsed && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground/70 tabular-nums whitespace-nowrap">
            {allCommits.length.toLocaleString()} commits · {branches.length} br · {tags.length} tags
          </span>
        )}
        {/* Maximize whichever view is active — static, at the far right. */}
        <PanelMaximizeButton
          id={view as PanelId}
          className={cn(view === 'workspace' && repoInfo && !collapsed ? '' : 'ml-auto')}
        />
      </div>
    </div>
  );
}

function SwitchButton({
  active, emphasize, onClick, title, children,
}: {
  active: boolean;
  /** Draw the eye — used when a plan is ready but the Plan tab isn't active. */
  emphasize?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
        active
          ? 'bg-primary/15 text-primary'
          : emphasize
            ? 'text-primary/80 hover:text-primary'
            : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
