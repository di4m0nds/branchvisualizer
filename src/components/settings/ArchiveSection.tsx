// Settings > Sessions > Archived. Two sub-lists (projects, threads) with
// per-row Restore / Delete-permanently actions and bulk equivalents. Deletion
// is gated by ConfirmDialog. Restore is instant and toasts on completion.

import { useMemo, useState } from 'react';
import { ArchiveRestore, FolderGit2, MessageSquare, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAppContext } from '@/store/AppContext';
import { toast } from '@/services/toast';
import { lastActivity } from '@/lib/sessionStatus';
import type { Project, Session } from '@/types/session';

type PendingAction =
  | { kind: 'delete-project'; id: string; name: string; threadCount: number }
  | { kind: 'delete-thread';  id: string; title: string }
  | { kind: 'bulk-delete-projects'; ids: string[] }
  | { kind: 'bulk-delete-threads'; ids: string[] }
  | null;

function Row({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div className={cn(
      'flex items-center gap-3 px-2.5 py-2 rounded-md border border-border/60 bg-background/40',
      active && 'ring-1 ring-primary/40',
    )}>
      {children}
    </div>
  );
}

export default function ArchiveSection() {
  const { state, dispatch } = useAppContext();
  const [pending, setPending] = useState<PendingAction>(null);

  const archivedProjects = useMemo(
    () => state.projects.filter((p) => p.archived),
    [state.projects],
  );
  const archivedThreads = useMemo(
    () => state.sessions.filter((s) => s.archived),
    [state.sessions],
  );
  const projectById = useMemo(
    () => new Map(state.projects.map((p) => [p.id, p])),
    [state.projects],
  );
  const threadCountByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of state.sessions) {
      map.set(s.projectId, (map.get(s.projectId) ?? 0) + 1);
    }
    return map;
  }, [state.sessions]);

  const restoreProject = (p: Project) => {
    dispatch({ type: 'ARCHIVE_PROJECT', id: p.id, archived: false });
    toast.success('Project restored', { description: p.name });
  };
  const restoreThread = (s: Session) => {
    dispatch({ type: 'ARCHIVE_SESSION', id: s.id, archived: false });
    toast.success('Thread restored', { description: s.title });
  };

  function runPending() {
    if (!pending) return;
    switch (pending.kind) {
      case 'delete-project':
        dispatch({ type: 'REMOVE_PROJECT', id: pending.id });
        toast.success('Project deleted', { description: pending.name });
        break;
      case 'delete-thread':
        dispatch({ type: 'CLOSE_SESSION', id: pending.id });
        toast.success('Thread deleted', { description: pending.title });
        break;
      case 'bulk-delete-projects':
        for (const id of pending.ids) dispatch({ type: 'REMOVE_PROJECT', id });
        toast.success(`Deleted ${pending.ids.length} archived project${pending.ids.length === 1 ? '' : 's'}`);
        break;
      case 'bulk-delete-threads':
        for (const id of pending.ids) dispatch({ type: 'CLOSE_SESSION', id });
        toast.success(`Deleted ${pending.ids.length} archived thread${pending.ids.length === 1 ? '' : 's'}`);
        break;
    }
    setPending(null);
  }

  const confirm = pendingConfirmProps(pending);

  return (
    <div className="mt-6 space-y-6">
      {/* Archived projects */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Archived projects</h3>
            <p className="text-[11px] text-muted-foreground/70">
              Restore returns a project to the sidebar. Deleting also removes its threads.
            </p>
          </div>
          {archivedProjects.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Button
                size="xs" variant="outline"
                onClick={() => {
                  for (const p of archivedProjects) dispatch({ type: 'ARCHIVE_PROJECT', id: p.id, archived: false });
                  toast.success(`Restored ${archivedProjects.length} project${archivedProjects.length === 1 ? '' : 's'}`);
                }}
              >
                <ArchiveRestore className="w-3 h-3" /> Restore all
              </Button>
              <Button
                size="xs" variant="destructive"
                onClick={() => setPending({ kind: 'bulk-delete-projects', ids: archivedProjects.map((p) => p.id) })}
              >
                <Trash2 className="w-3 h-3" /> Delete all
              </Button>
            </div>
          )}
        </div>
        {archivedProjects.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/60 italic px-1 py-2">No archived projects.</p>
        ) : (
          <div className="space-y-1">
            {archivedProjects.map((p) => {
              const count = threadCountByProject.get(p.id) ?? 0;
              return (
                <Row key={p.id}>
                  <FolderGit2 className="w-4 h-4 text-muted-foreground/70 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground truncate" title={p.path}>{p.name}</p>
                    <p className="text-[10px] text-muted-foreground/60 truncate font-mono" title={p.path}>{p.path}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                    {count} thread{count === 1 ? '' : 's'}
                  </span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button size="xs" variant="outline" onClick={() => restoreProject(p)}>
                      <ArchiveRestore className="w-3 h-3" /> Restore
                    </Button>
                    <Button
                      size="xs" variant="destructive"
                      onClick={() => setPending({ kind: 'delete-project', id: p.id, name: p.name, threadCount: count })}
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </Button>
                  </div>
                </Row>
              );
            })}
          </div>
        )}
      </div>

      {/* Archived threads */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Archived threads</h3>
            <p className="text-[11px] text-muted-foreground/70">
              Restore returns the thread to its project. Delete removes it permanently.
            </p>
          </div>
          {archivedThreads.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Button
                size="xs" variant="outline"
                onClick={() => {
                  for (const s of archivedThreads) dispatch({ type: 'ARCHIVE_SESSION', id: s.id, archived: false });
                  toast.success(`Restored ${archivedThreads.length} thread${archivedThreads.length === 1 ? '' : 's'}`);
                }}
              >
                <ArchiveRestore className="w-3 h-3" /> Restore all
              </Button>
              <Button
                size="xs" variant="destructive"
                onClick={() => setPending({ kind: 'bulk-delete-threads', ids: archivedThreads.map((s) => s.id) })}
              >
                <Trash2 className="w-3 h-3" /> Delete all
              </Button>
            </div>
          )}
        </div>
        {archivedThreads.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/60 italic px-1 py-2">No archived threads.</p>
        ) : (
          <div className="space-y-1">
            {archivedThreads.map((s) => {
              const parent = projectById.get(s.projectId);
              return (
                <Row key={s.id}>
                  <MessageSquare className="w-4 h-4 text-muted-foreground/70 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground truncate" title={s.title}>{s.title}</p>
                    <p className="text-[10px] text-muted-foreground/60 truncate">
                      {parent ? parent.name : <span className="italic">unknown project</span>}
                      {' · '}
                      {lastActivity(s)}
                      {' · '}
                      {s.messages.length} message{s.messages.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button size="xs" variant="outline" onClick={() => restoreThread(s)}>
                      <ArchiveRestore className="w-3 h-3" /> Restore
                    </Button>
                    <Button
                      size="xs" variant="destructive"
                      onClick={() => setPending({ kind: 'delete-thread', id: s.id, title: s.title })}
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </Button>
                  </div>
                </Row>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={confirm.confirmLabel}
        variant="destructive"
        onCancel={() => setPending(null)}
        onConfirm={runPending}
      />
    </div>
  );
}

function pendingConfirmProps(pending: PendingAction): {
  title: string; description: React.ReactNode; confirmLabel: string;
} {
  if (!pending) return { title: '', description: null, confirmLabel: 'Delete' };
  switch (pending.kind) {
    case 'delete-project':
      return {
        title: `Permanently delete project "${pending.name}"?`,
        description: pending.threadCount > 0
          ? <>This will also delete <strong>{pending.threadCount}</strong> thread{pending.threadCount === 1 ? '' : 's'} under it. This cannot be undone.</>
          : <>This cannot be undone.</>,
        confirmLabel: 'Delete project',
      };
    case 'delete-thread':
      return {
        title: `Permanently delete thread "${pending.title}"?`,
        description: <>This cannot be undone.</>,
        confirmLabel: 'Delete thread',
      };
    case 'bulk-delete-projects':
      return {
        title: `Delete ${pending.ids.length} archived project${pending.ids.length === 1 ? '' : 's'}?`,
        description: <>All threads under these projects will also be deleted. This cannot be undone.</>,
        confirmLabel: 'Delete all',
      };
    case 'bulk-delete-threads':
      return {
        title: `Delete ${pending.ids.length} archived thread${pending.ids.length === 1 ? '' : 's'}?`,
        description: <>This cannot be undone.</>,
        confirmLabel: 'Delete all',
      };
  }
}
