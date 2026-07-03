// Collapsed sidebar — an icon-only rail. Shows one glyph per (non-archived)
// project; clicking a project expands the sidebar and selects its most-recent
// thread. A chevron at the top expands back to the full sidebar. Keeps the
// footer's "add project" affordance reachable while collapsed.

import { useMemo } from 'react';
import { FolderGit2, PanelLeftOpen, FolderPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/store/AppContext';
import type { Session } from '@/types/session';

interface Props {
  onExpand: () => void;
  onAddProject: () => void;
  isAdding?: boolean;
}

export default function SidebarRail({ onExpand, onAddProject, isAdding }: Props) {
  const { state, dispatch } = useAppContext();

  const sessionsByProject = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of state.sessions) {
      if (!s.projectId) continue;
      const list = map.get(s.projectId);
      if (list) list.push(s); else map.set(s.projectId, [s]);
    }
    return map;
  }, [state.sessions]);

  const projects = useMemo(
    () => state.projects.filter((p) => !p.archived),
    [state.projects],
  );

  const activeProjectId = useMemo(() => {
    const active = state.sessions.find((s) => s.id === state.activeSessionId);
    return active?.projectId ?? null;
  }, [state.sessions, state.activeSessionId]);

  function openProject(projectId: string) {
    const threads = sessionsByProject.get(projectId) ?? [];
    // Prefer the most recently active thread; fall back to the first.
    const latest = [...threads].sort((a, b) => {
      const ta = new Date(a.messages[a.messages.length - 1]?.ts ?? 0).getTime();
      const tb = new Date(b.messages[b.messages.length - 1]?.ts ?? 0).getTime();
      return tb - ta;
    })[0];
    if (latest) dispatch({ type: 'SET_ACTIVE_SESSION', id: latest.id });
    onExpand();
  }

  return (
    <div className="flex flex-col items-center flex-1 min-h-0 w-12 border-r border-border bg-muted/10 py-2 gap-1">
      <button
        onClick={onExpand}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
        title="Expand sidebar"
      >
        <PanelLeftOpen className="w-4 h-4" />
      </button>

      <div className="w-6 h-px bg-border/60 my-1" />

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col items-center gap-1">
        {projects.map((p) => {
          const active = p.id === activeProjectId;
          const threadCount = sessionsByProject.get(p.id)?.length ?? 0;
          return (
            <button
              key={p.id}
              onClick={() => openProject(p.id)}
              className={cn(
                'relative p-1.5 rounded-md transition-colors',
                active
                  ? 'bg-primary/12 text-primary ring-1 ring-inset ring-primary/25'
                  : 'text-muted-foreground/80 hover:text-foreground hover:bg-accent/40',
              )}
              title={`${p.name}${threadCount ? ` · ${threadCount} thread${threadCount === 1 ? '' : 's'}` : ''}`}
            >
              <FolderGit2 className="w-4 h-4" />
              {threadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-muted text-[8px] leading-[13px] font-semibold text-muted-foreground/90 tabular-nums">
                  {threadCount > 9 ? '9+' : threadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="w-6 h-px bg-border/60 my-1" />

      <button
        onClick={onAddProject}
        disabled={isAdding}
        className={cn(
          'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors',
          isAdding && 'opacity-50 cursor-wait',
        )}
        title="Add project"
      >
        <FolderPlus className="w-4 h-4" />
      </button>
    </div>
  );
}
