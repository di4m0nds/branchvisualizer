// One thread (session) row in the sidebar. Active thread is marked with a
// primary-tinted fill + inset ring; hover-revealed overflow menu (Archive /
// Delete-with-confirm) mirrors ProjectGroup's pattern. Truncation is standard
// CSS ellipsis that reacts to container width, so the resizable sidebar just
// works.

import { useEffect, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, GitBranch, MoreHorizontal, Pencil, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { lastActivity, statusMeta } from '@/lib/sessionStatus';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import type { Session } from '@/types/session';

interface Props {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}

export default function ThreadItem({ session, active, onSelect, onArchiveToggle, onDelete, onRename }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  function startRename() {
    setRenameValue(session.title);
    setRenaming(true);
  }
  function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.title) onRename(trimmed);
    setRenaming(false);
  }
  function cancelRename() {
    setRenameValue(session.title);
    setRenaming(false);
  }

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
          'group relative flex items-center gap-2 px-2.5 py-1 rounded-md cursor-pointer transition-colors',
          active
            ? 'bg-primary/12 text-foreground font-semibold ring-1 ring-inset ring-primary/25'
            : 'text-muted-foreground hover:bg-accent/25 hover:text-foreground',
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
            className="min-w-0 flex-1 bg-background border border-border rounded px-1.5 py-0 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        ) : (
          <span
            onDoubleClick={(e) => { e.stopPropagation(); startRename(); }}
            className="min-w-0 flex-1 text-xs font-medium truncate"
          >
            {session.title}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/50 whitespace-nowrap flex-shrink-0">
          {lastActivity(session)}
        </span>
        <div className="relative flex-shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'p-0.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent/40 transition-opacity',
                  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
                )}
                title="More"
              >
                <MoreHorizontal className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-36" onClick={(e) => e.stopPropagation()}>
              {/* Defer past radix's close/focus-restore so the rename input keeps focus. */}
              <DropdownMenuItem onSelect={() => setTimeout(startRename, 0)}>
                <Pencil className="w-3 h-3" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onArchiveToggle()}>
                {isArchived
                  ? <><ArchiveRestore className="w-3 h-3" /> Unarchive</>
                  : <><Archive className="w-3 h-3" /> Archive</>}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
                <Trash2 className="w-3 h-3" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
