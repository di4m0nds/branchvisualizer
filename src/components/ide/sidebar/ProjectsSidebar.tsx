// Left rail — replaces the old flat SessionRail. Header (search + sort + add
// + show-archived toggle), a list of ProjectGroup rows, and a footer link back
// to the visualizer. Add-project uses the native folder picker + loadLocalRepo
// validation (mirrors the pattern in RepoSearch.handleBrowse).

import { useEffect, useMemo, useRef, useState } from 'react';
import { closeSession } from '@/lib/sessionLifecycle';
import { Link } from 'react-router-dom';
import {
  Archive, ArrowDown10, ArrowDownAZ, Check, Eye, EyeOff, FolderPlus,
  PanelLeftClose, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { useAppSelector, useAppDispatch } from '@/store/store';
import { useRepoData } from '@/hooks/useRepoData';
import { toast } from '@/services/toast';
import { isTauri } from '@/lib/platform';
import { fetchStatus } from '@/lib/localGit';
import { loadAgentDefaults } from '@/lib/agentDefaults';
import { createSession } from '@/lib/sessions';
import { nextId } from '@/types/session';
import type { Project, Session } from '@/types/session';
import ProjectGroup from './ProjectGroup';
import SidebarRail from './SidebarRail';
import { useSidebarPrefs, type SortMode } from './useSidebarPrefs';
import { useSidebarSearch } from './useSidebarSearch';

function normalizePath(p: string): string {
  return p.replace(/[/\\]+$/, '');
}

function basename(p: string): string {
  const t = normalizePath(p);
  const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
  return (i >= 0 ? t.slice(i + 1) : t) || p;
}

const SORT_OPTIONS: { id: SortMode; label: string; Icon: typeof ArrowDown10 }[] = [
  { id: 'recent', label: 'Recent activity', Icon: ArrowDown10 },
  { id: 'name',   label: 'Alphabetical (A → Z)', Icon: ArrowDownAZ },
];

export default function ProjectsSidebar({
  railCollapsed = false,
  onToggleRail,
}: {
  /** When true the sidebar renders as an icon-only rail. */
  railCollapsed?: boolean;
  onToggleRail?: () => void;
} = {}) {
  const dispatch = useAppDispatch();
  const sessions = useAppSelector((s) => s.sessions);
  const projects = useAppSelector((s) => s.projects);
  const activeSessionId = useAppSelector((s) => s.activeSessionId);
  const { loadLocalRepo } = useRepoData();
  const { collapsed, showArchived, sort, toggleCollapsed, setShowArchived, setSort } = useSidebarPrefs();

  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Ctrl+K focuses the search box while the sidebar is mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!sortOpen) return;
    const onClick = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [sortOpen]);

  // Group sessions by projectId. Sessions with an unknown/empty projectId are
  // orphaned by the migration (shouldn't normally happen); we drop them from
  // the tree — they remain in state, just not surfaced here.
  const sessionsByProject = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      if (!s.projectId) continue;
      const list = map.get(s.projectId);
      if (list) list.push(s); else map.set(s.projectId, [s]);
    }
    return map;
  }, [sessions]);

  // Filter archived + sort. Sort by most recent activity across the project's
  // threads (or createdAt as a fallback for empty projects).
  const visibleProjects = useMemo(() => {
    const list = projects.filter((p) => showArchived || !p.archived);
    if (sort === 'name') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    const lastTouched = (p: Project) => {
      const threads = sessionsByProject.get(p.id) ?? [];
      let latest = new Date(p.createdAt).getTime() || 0;
      for (const s of threads) {
        const last = s.messages[s.messages.length - 1];
        if (!last) continue;
        const t = new Date(last.ts).getTime();
        if (Number.isFinite(t) && t > latest) latest = t;
      }
      return latest;
    };
    return [...list].sort((a, b) => lastTouched(b) - lastTouched(a));
  }, [projects, sessionsByProject, showArchived, sort]);

  const filtered = useSidebarSearch(visibleProjects, sessionsByProject, query, showArchived);

  async function handleAddProject() {
    if (!isTauri()) {
      toast.info('Folder picker requires the desktop app', {
        description: 'Run `pnpm tauri dev` to add projects.',
      });
      return;
    }
    setIsAdding(true);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false, title: 'Add project' });
      if (typeof picked !== 'string') return;
      const canonical = normalizePath(picked);

      const existing = projects.find((p) => normalizePath(p.path) === canonical);
      if (existing) {
        if (existing.archived) dispatch({ type: 'ARCHIVE_PROJECT', id: existing.id, archived: false });
        toast.info('Project already registered', { description: existing.name });
        const first = sessionsByProject.get(existing.id)?.[0];
        if (first) dispatch({ type: 'SET_ACTIVE_SESSION', id: first.id });
        return;
      }

      try {
        await loadLocalRepo(canonical);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Not a git repository');
        return;
      }

      const project: Project = {
        id: nextId('project'),
        name: basename(canonical),
        path: canonical,
        source: 'local',
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_PROJECT', project });
      toast.success('Project added', { description: project.name });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open folder picker');
    } finally {
      setIsAdding(false);
    }
  }

  function handleNewThread(project: Project) {
    const defaults = loadAgentDefaults();
    const session = createSession(project, defaults);
    dispatch({ type: 'CREATE_SESSION', session });
    if (project.source === 'local' && session.cwd) {
      fetchStatus(session.cwd)
        .then((st) => {
          const summary = st.clean
            ? 'clean'
            : `${st.staged.length} staged · ${st.unstaged.length} unstaged · ${st.untracked.length} untracked`;
          dispatch({ type: 'SET_SESSION_GIT', sessionId: session.id, branch: st.branch, statusSummary: summary });
        })
        .catch(() => { /* desktop-only; ignore in browser */ });
    }
  }

  const orphanedCount = sessions.filter((s) => !s.projectId || !projects.some((p) => p.id === s.projectId)).length;
  const sortActive = SORT_OPTIONS.find((o) => o.id === sort) ?? SORT_OPTIONS[0];
  const SortIcon = sortActive.Icon;

  if (railCollapsed) {
    return (
      <SidebarRail
        onExpand={() => onToggleRail?.()}
        onAddProject={handleAddProject}
        isAdding={isAdding}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 border-r border-border bg-muted/10">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-border/70 space-y-2.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Search"
            spellCheck={false}
            className="w-full h-8 bg-background/80 border border-border rounded-md pl-8 pr-14 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/35 focus:border-primary/50 transition-colors"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono text-muted-foreground/50 border border-border/60 rounded px-1 py-0.5">
            Ctrl+K
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            Projects
          </span>
          <div className="flex items-center gap-0.5">
            <div ref={sortMenuRef} className="relative">
              <button
                onClick={() => setSortOpen((o) => !o)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                title={`Sort: ${sortActive.label}`}
              >
                <SortIcon className="w-3.5 h-3.5" />
              </button>
              {sortOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-border bg-popover shadow-lg text-xs overflow-hidden">
                  <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 border-b border-border/60">
                    Sort by
                  </div>
                  {SORT_OPTIONS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      onClick={() => { setSort(id); setSortOpen(false); }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent/40 text-foreground"
                    >
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="flex-1">{label}</span>
                      {sort === id && <Check className="w-3 h-3 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handleAddProject}
              disabled={isAdding}
              className={cn(
                'p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors',
                isAdding && 'opacity-50 cursor-wait',
              )}
              title="Add project"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            {onToggleRail && (
              <button
                onClick={onToggleRail}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/60 px-2 py-4 leading-relaxed">
            {projects.length === 0
              ? <>No projects yet. Click the <span className="inline-flex align-middle mx-0.5"><FolderPlus className="w-3 h-3" /></span> above to add one from disk.</>
              : query.trim()
                ? 'No projects or threads match your search.'
                : 'All projects are archived. Enable “Show archived” below.'}
          </p>
        ) : (
          filtered.map(({ project, threads, threadHit }, i) => {
            const isCollapsed = query.trim() && threadHit
              ? false
              : Boolean(collapsed[project.id]);
            return (
              <div key={project.id} className={cn(i > 0 && 'border-t border-border/30 pt-0.5 mt-0.5')}>
                <ProjectGroup
                  project={project}
                  threads={threads}
                  activeSessionId={activeSessionId}
                  collapsed={isCollapsed}
                  showArchived={showArchived}
                  onToggleCollapsed={() => toggleCollapsed(project.id)}
                  onRename={(name) => dispatch({ type: 'RENAME_PROJECT', id: project.id, name })}
                  onArchiveToggle={() => dispatch({ type: 'ARCHIVE_PROJECT', id: project.id, archived: !project.archived })}
                  onDelete={() => dispatch({ type: 'REMOVE_PROJECT', id: project.id })}
                  onNewThread={() => handleNewThread(project)}
                  onSelectThread={(id) => dispatch({ type: 'SET_ACTIVE_SESSION', id })}
                  onArchiveThread={(id, archived) => dispatch({ type: 'ARCHIVE_SESSION', id, archived })}
                  onDeleteThread={(id) => closeSession(id)}
                  onRenameThread={(id, title) => dispatch({ type: 'RENAME_SESSION', id, title })}
                  onShowArchived={() => setShowArchived(true)}
                />
              </div>
            );
          })
        )}
        {orphanedCount > 0 && (
          <p className="text-[10px] text-amber-500/70 px-2 py-2 mt-1 border-t border-border">
            {orphanedCount} orphaned thread{orphanedCount === 1 ? '' : 's'} (missing project link)
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border flex items-center gap-2 text-[10px] text-muted-foreground">
        <button
          onClick={() => setShowArchived(!showArchived)}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          title={showArchived ? 'Hide archived items' : 'Show archived items'}
        >
          {showArchived ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          <Archive className="w-3 h-3" />
          <span>{showArchived ? 'Hide archived' : 'Show archived'}</span>
        </button>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <Link to="/" className="hover:text-foreground transition-colors">
          Visualizer →
        </Link>
      </div>
    </div>
  );
}
