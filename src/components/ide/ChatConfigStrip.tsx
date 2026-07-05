import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import SessionContextBar from './SessionContextBar';
import ModelSelect from './ModelSelect';
import ContextSelect from './ContextSelect';
import BranchIndicator from './BranchIndicator';
import type { Session } from '@/types/session';

// The IDE's agent configuration, docked at the top of the middle (agent) column
// — deliberately NOT over the BranchVisualizer. Collapses to a single glanceable
// posture line so it costs almost no vertical space once configured.

export default function ChatConfigStrip({
  session, collapsed, onToggle,
}: {
  session: Session;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const c = session.context;
  const summary = `${c.accessLevel.replace('_', ' ')} · ${c.buildMode} · ${c.reasoningBudget} · ${c.pinnedRules.length} pinned`;

  return (
    <div className="flex-shrink-0 border-b border-border bg-muted/10">
      <div className="flex items-center gap-2 px-3 h-9">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          title={collapsed ? 'Expand agent settings' : 'Collapse agent settings'}
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span className="text-[11px] font-semibold uppercase tracking-wider">Agent</span>
        </button>
        {collapsed && (
          <span className="text-[10px] font-mono text-muted-foreground/70 truncate capitalize">{summary}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <BranchIndicator session={session} />
          <ModelSelect />
          <ContextSelect />
        </div>
      </div>
      <div className={cn('overflow-hidden transition-[max-height] duration-200', collapsed ? 'max-h-0' : 'max-h-96')}>
        <SessionContextBar session={session} />
      </div>
    </div>
  );
}
