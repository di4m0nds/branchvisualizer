import { useMemo, useState } from 'react';
import { closeSession } from '@/lib/sessionLifecycle';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Trash2, FolderGit2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppSelector, useAppDispatch } from '@/store/store';
import { lastActivity, statusDot } from '@/lib/sessionStatus';
import type { Session } from '@/types/session';

// Lists persisted sessions so they're reachable from the visualizer views (not
// just inside the IDE). `inline` renders a flat list section; `popover` renders
// a dropdown trigger. `filterRepoRef` narrows to one project's sessions.

function SessionRow({ s, onOpen, onDelete }: { s: Session; onOpen: () => void; onDelete: () => void }) {
  return (
    <div
      onClick={onOpen}
      className="group flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer text-muted-foreground hover:bg-accent/30 hover:text-foreground transition-colors"
    >
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusDot(s))} />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-xs font-medium truncate text-foreground">{s.title}</span>
        <span className="text-[10px] text-muted-foreground/60 truncate font-mono">{s.repoRef}</span>
      </div>
      <span className="text-[10px] text-muted-foreground/50 whitespace-nowrap flex items-center gap-1">
        <MessageSquare className="w-3 h-3" />{s.messages.length}
      </span>
      <span className="text-[10px] text-muted-foreground/40 whitespace-nowrap hidden sm:inline">{lastActivity(s)}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
        title="Delete session"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function SessionsPanel({
  variant = 'inline',
  filterRepoRef,
}: {
  variant?: 'inline' | 'popover';
  filterRepoRef?: string;
}) {
  const dispatch = useAppDispatch();
  const allSessions = useAppSelector((s) => s.sessions);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const sessions = useMemo(() => {
    const ref = filterRepoRef?.trim();
    if (!ref) return allSessions;
    // Normalize: GitHub refs are case-insensitive (owner/repo), and a session
    // may key off either its repoRef or its local cwd. Match on either so the
    // standalone visualizer page lists the same sessions the IDE does.
    const norm = ref.toLowerCase();
    return allSessions.filter(
      (s) => s.repoRef.toLowerCase() === norm || (s.cwd && s.cwd.toLowerCase() === norm),
    );
  }, [allSessions, filterRepoRef]);

  const openSession = (id: string) => {
    dispatch({ type: 'SET_ACTIVE_SESSION', id });
    navigate('/ide');
  };
  const deleteSession = (id: string) => closeSession(id);

  const list = (
    <div className="space-y-0.5">
      {sessions.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/60 px-2.5 py-3">No saved sessions{filterRepoRef ? ' for this repository' : ''} yet.</p>
      ) : (
        sessions.map((s) => (
          <SessionRow key={s.id} s={s} onOpen={() => openSession(s.id)} onDelete={() => deleteSession(s.id)} />
        ))
      )}
    </div>
  );

  if (variant === 'popover') {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-muted/20 hover:bg-accent/40 text-[11px] font-mono text-foreground transition-colors"
          title="Saved sessions"
        >
          <FolderGit2 className="w-3.5 h-3.5" />
          Sessions
          <span className="text-muted-foreground/60">{sessions.length}</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full z-50 mt-1 w-[340px] max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-popover shadow-xl p-1.5">
              {list}
            </div>
          </>
        )}
      </div>
    );
  }

  return list;
}
