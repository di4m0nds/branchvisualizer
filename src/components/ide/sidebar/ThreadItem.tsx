// One thread (session) row in the sidebar. Left accent bar marks the active
// thread; hover-revealed overflow menu (Archive / Delete-with-confirm) mirrors
// ProjectGroup's pattern. Truncation is standard CSS ellipsis that reacts to
// container width, so the resizable sidebar just works.

import { useEffect, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, GitBranch, MoreHorizontal, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { lastActivity, statusMeta } from '@/lib/sessionStatus';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { Session } from '@/types/session';

interface Props {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
}

export default function ThreadItem({ session, active, onSelect, onArchiveToggle, onDelete }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const isArchived = Boolean(session.archived);
  const meta = statusMeta(session.context.status);
  const hasGitBranch = Boolean(session.context.gitBranch);
  // Show the git-branch icon as the leading indicator for idle git-linked
  // threads; otherwise the colored status dot conveys state more clearly.
  const showBranchIcon = hasGitBranch && !meta.hasPill;

  return (
    <>
      <div
        onClick={onSelect}
        title={session.context.gitBranch ? `${session.title}\n${session.context.gitBranch}` : session.title}
        className={cn(
          'group relative flex items-center gap-2 pl-4 pr-1.5 py-1 rounded-md cursor-pointer transition-colors border-l-2',
          active
            ? 'bg-accent/40 text-foreground border-l-primary'
            : 'text-muted-foreground hover:bg-accent/20 hover:text-foreground border-l-transparent',
          isArchived && 'opacity-70',
        )}
      >
        {/* Leading indicator: branch icon (git-linked idle) or colored dot */}
        {showBranchIcon
          ? <GitBranch className="w-3 h-3 flex-shrink-0 text-muted-foreground/70" />
          : <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', meta.dotClass)} />}

        {isArchived && <Archive className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />}

        {/* Status pill (non-idle only) */}
        {meta.hasPill && (
          <span
            className={cn(
              'inline-flex items-center px-1.5 py-[1px] rounded-full text-[10px] font-medium leading-none whitespace-nowrap flex-shrink-0',
              meta.pillClass,
            )}
          >
            {meta.label}
          </span>
        )}

        <span className="min-w-0 flex-1 text-xs font-medium truncate">{session.title}</span>
        <span className="text-[10px] text-muted-foreground/50 whitespace-nowrap flex-shrink-0">
          {lastActivity(session)}
        </span>
        <div ref={menuRef} className="relative flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            className={cn(
              'p-0.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent/40 transition-opacity',
              menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
            title="More"
          >
            <MoreHorizontal className="w-3 h-3" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md border border-border bg-popover shadow-lg text-xs overflow-hidden">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onArchiveToggle(); }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent/40 text-foreground"
              >
                {isArchived
                  ? <><ArchiveRestore className="w-3 h-3" /> Unarchive</>
                  : <><Archive className="w-3 h-3" /> Archive</>}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setConfirmOpen(true); }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-destructive/20 text-destructive"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={`Delete thread "${session.title}"?`}
        description="This will remove the conversation history for this thread. This cannot be undone."
        confirmLabel="Delete thread"
        variant="destructive"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); onDelete(); }}
      />
    </>
  );
}
