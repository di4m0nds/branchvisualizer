import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react';
import { useAppContext } from '@/store/AppContext';

// The BranchVisualizer's own configuration header, docked at the top of the
// right column — separate from the agent config so each pane keeps its own
// controls. Collapses to a single line. TabWorkspace keeps its internal
// graph/split/direction toolbar; this strip owns repo identity + collapse.

export default function BvConfigStrip({
  collapsed, onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
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
          <span className="text-[11px] font-semibold uppercase tracking-wider">Repository</span>
        </button>
        {/* Collapsing hides the repo identity + counts, leaving just the header
            toggle. The graph toolbar lives inside TabWorkspace and stays
            available below regardless of this strip's state. */}
        {repoInfo && !collapsed && (
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-foreground/80 truncate">
            <GitBranch className="w-3 h-3 text-muted-foreground" />
            <span className="truncate">{repoInfo.fullName}</span>
          </span>
        )}
        {repoInfo && !collapsed && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground/70 tabular-nums whitespace-nowrap">
            {allCommits.length.toLocaleString()} commits · {branches.length} br · {tags.length} tags
          </span>
        )}
      </div>
    </div>
  );
}
