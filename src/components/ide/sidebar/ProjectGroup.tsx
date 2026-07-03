// A collapsible project section: header (chevron + icon + name with inline
// rename) plus its threads. Header row surfaces "+ new thread" and an overflow
// menu (archive/unarchive/delete) on hover. Archived threads hide unless
// `showArchived` is on; project delete uses the shared ConfirmDialog.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, ChevronDown, ChevronRight, FolderGit2,
  MoreHorizontal, Plus, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { Project, Session } from '@/types/session';
import ThreadItem from './ThreadItem';

interface Props {
  project: Project;
  threads: Session[];
  activeSessionId: string | null;
  collapsed: boolean;
  showArchived: boolean;
  onToggleCollapsed: () => void;
  onRename: (name: string) => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
  onNewThread: () => void;
  onSelectThread: (id: string) => void;
  onArchiveThread: (id: string, archived: boolean) => void;
  onDeleteThread: (id: string) => void;
  onRenameThread: (id: string, title: string) => void;
  onShowArchived: () => void;
}

const MAX_INLINE_THREADS = 8;

export default function ProjectGroup({
  project, threads, activeSessionId, collapsed, showArchived,
  onToggleCollapsed, onRename, onArchiveToggle, onDelete,
  onNewThread, onSelectThread, onArchiveThread, onDeleteThread,
  onRenameThread, onShowArchived,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== project.name) onRename(trimmed);
    else setRenameValue(project.name);
    setRenaming(false);
  }

  function cancelRename() {
    setRenameValue(project.name);
    setRenaming(false);
  }

  // Filter archived threads out of the visible set unless the toggle is on.
  // Count hidden archived so the empty state can prompt the user to enable it.
  const visibleThreads = useMemo(
    () => (showArchived ? threads : threads.filter((s) => !s.archived)),
    [threads, showArchived],
  );
  const archivedCount = threads.length - visibleThreads.length;

  const paged = showAll || visibleThreads.length <= MAX_INLINE_THREADS
    ? visibleThreads
    : visibleThreads.slice(0, MAX_INLINE_THREADS);

  const hasActiveThread = activeSessionId
    ? threads.some((s) => s.id === activeSessionId)
    : false;

  return (
    <div className={cn('mb-0.5', project.archived && 'opacity-70')}>
      {/* Header row */}
      <div
        onClick={() => !renaming && onToggleCollapsed()}
        className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/20 transition-colors"
      >
        <button
          onClick={(e) => { e.stopPropagation(); onToggleCollapsed(); }}
          className="text-muted-foreground hover:text-foreground flex-shrink-0"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5" />
            : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <FolderGit2 className={cn(
          'w-4 h-4 flex-shrink-0',
          hasActiveThread ? 'text-primary/80' : 'text-muted-foreground/70',
        )} />
        {renaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
            }}
            className="min-w-0 flex-1 bg-background border border-border rounded px-1.5 py-0.5 text-[13px] font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        ) : (
          <span
            onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true); }}
            className="min-w-0 flex-1 text-[13px] font-semibold text-foreground truncate select-none"
            title={`${project.path}${project.archived ? ' (archived)' : ''}`}
          >
            {project.name}
          </span>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onNewThread(); }}
            className="p-0.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent/40"
            title="New thread"
          >
            <Plus className="w-3 h-3" />
          </button>
          <div ref={menuRef} className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
              className="p-0.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent/40"
              title="More"
            >
              <MoreHorizontal className="w-3 h-3" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border border-border bg-popover shadow-lg text-xs overflow-hidden">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onArchiveToggle(); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent/40 text-foreground"
                >
                  {project.archived
                    ? <><ArchiveRestore className="w-3 h-3" /> Unarchive</>
                    : <><Archive className="w-3 h-3" /> Archive</>}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setConfirmDelete(true); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-destructive/20 text-destructive"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="mt-0.5 space-y-0.5">
          {visibleThreads.length === 0 ? (
            <div className="pl-6 pr-2 py-1 text-[11px] text-muted-foreground/60 italic">
              <p>No threads yet — click + to create one.</p>
              {archivedCount > 0 && (
                <button
                  onClick={onShowArchived}
                  className="mt-0.5 not-italic text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  {archivedCount} archived · Show archived
                </button>
              )}
            </div>
          ) : (
            <>
              {paged.map((s) => (
                <ThreadItem
                  key={s.id}
                  session={s}
                  active={s.id === activeSessionId}
                  onSelect={() => onSelectThread(s.id)}
                  onArchiveToggle={() => onArchiveThread(s.id, !s.archived)}
                  onDelete={() => onDeleteThread(s.id)}
                  onRename={(title) => onRenameThread(s.id, title)}
                />
              ))}
              {visibleThreads.length > MAX_INLINE_THREADS && (
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="pl-6 pr-2 py-1 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  {showAll ? 'Show less' : `Show ${visibleThreads.length - MAX_INLINE_THREADS} more`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete project "${project.name}"?`}
        description={
          threads.length > 0
            ? <>This will also delete <strong>{threads.length}</strong> thread{threads.length === 1 ? '' : 's'} under this project. This cannot be undone.</>
            : <>This cannot be undone.</>
        }
        confirmLabel="Delete project"
        variant="destructive"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); onDelete(); }}
      />
    </div>
  );
}
