// apps/branchvisualizer/src/components/workspace/assistant/SessionList.tsx
// Left sidebar: session list with mode icons and actions.

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { AssistantSession, SessionMode } from '@/store/assistantStore';

function ModeIcon({ mode }: { mode: SessionMode }) {
  if (mode === 'pr') return (
    <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"/>
    </svg>
  );
  if (mode === 'review') return (
    <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/>
    </svg>
  );
  return (
    <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 13H8.061l-2.574 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Z"/>
    </svg>
  );
}

function timeAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ─── Confirm delete modal ─────────────────────────────────────────────────────

interface ConfirmDeleteModalProps {
  session: AssistantSession;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDeleteModal({ session, onConfirm, onCancel }: ConfirmDeleteModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const modal = (
    <AnimatePresence>
      <>
        {/* Backdrop */}
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-[2px]"
          onClick={onCancel}
        />

        {/* Modal */}
        <motion.div
          key="modal"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="fixed z-[301] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                     w-72 bg-card border border-border rounded-xl shadow-2xl p-4 flex flex-col gap-3"
          onClick={e => e.stopPropagation()}
        >
          <div>
            <p className="text-sm font-semibold text-foreground mb-1">Delete session?</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed truncate">
              "{session.title}"
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium border border-border/60
                         text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/10 border border-red-500/30
                         text-red-400 hover:bg-red-500/20 hover:border-red-500/50 transition-colors"
            >
              Delete
            </button>
          </div>
        </motion.div>
      </>
    </AnimatePresence>
  );

  return createPortal(modal, document.body);
}

// ─── Session row ──────────────────────────────────────────────────────────────

interface SessionRowProps {
  session: AssistantSession;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDeleteRequest: (session: AssistantSession) => void;
}

function SessionRow({ session, isActive, onSelect, onDeleteRequest }: SessionRowProps) {
  const msgCount = session.messages.filter(m => m.role !== 'system').length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8, height: 0, overflow: 'hidden' }}
      transition={{ duration: 0.12 }}
      className="relative group"
    >
      <button
        onClick={() => onSelect(session.id)}
        className={cn(
          'w-full flex flex-col gap-0.5 px-2.5 py-2 text-left transition-colors rounded-lg mx-0.5',
          isActive
            ? 'bg-accent/70 text-foreground'
            : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn(
            'flex-shrink-0 transition-colors',
            isActive ? 'text-primary' : 'text-muted-foreground/50',
          )}>
            <ModeIcon mode={session.mode} />
          </span>
          <span className="text-[11px] font-medium truncate flex-1 leading-none">
            {session.title}
          </span>
          {session.streaming && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-pulse flex-shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1.5 pl-3.5">
          <span className="text-[9px] text-muted-foreground/40">
            {msgCount > 0 ? `${msgCount} msg${msgCount > 1 ? 's' : ''}` : 'empty'}
          </span>
          <span className="text-[9px] text-muted-foreground/30">·</span>
          <span className="text-[9px] text-muted-foreground/30">
            {timeAgoShort(session.updatedAt)}
          </span>
        </div>
      </button>

      {/* Delete button — only on hover */}
      <button
        onClick={e => { e.stopPropagation(); onDeleteRequest(session); }}
        title="Delete session"
        className="absolute top-2 right-1.5 w-4 h-4 flex items-center justify-center rounded
                   text-muted-foreground/40 hover:text-red-400
                   opacity-0 group-hover:opacity-100 hover:bg-red-400/10 transition-all"
      >
        <svg width="7" height="7" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
        </svg>
      </button>
    </motion.div>
  );
}

// ─── Session list ─────────────────────────────────────────────────────────────

interface SessionListProps {
  sessions: AssistantSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: (mode?: SessionMode) => void;
}

export default function SessionList({
  sessions, activeSessionId, onSelect, onDelete, onNew,
}: SessionListProps) {
  const [deletePending, setDeletePending] = useState<AssistantSession | null>(null);

  const handleNew = useCallback(() => onNew('chat'), [onNew]);

  const handleDeleteRequest = useCallback((session: AssistantSession) => {
    setDeletePending(session);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (deletePending) {
      onDelete(deletePending.id);
      setDeletePending(null);
    }
  }, [deletePending, onDelete]);

  const handleDeleteCancel = useCallback(() => {
    setDeletePending(null);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-muted/10">
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-border/40 flex-shrink-0">
        <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
          Sessions
        </span>
        <button
          onClick={handleNew}
          title="New chat session"
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/50
                     hover:text-foreground hover:bg-accent transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
            <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/>
          </svg>
        </button>
      </div>

      {/* Quick-start buttons */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/30 flex-shrink-0">
        {(['pr', 'review'] as SessionMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => onNew(mode)}
            title={`New ${mode === 'pr' ? 'PR description' : 'code review'} session`}
            className="flex-1 text-[9px] py-1 px-1.5 rounded border border-border/40 bg-muted/20
                       text-muted-foreground/60 hover:border-border hover:text-foreground
                       hover:bg-accent/40 transition-colors font-medium"
          >
            {mode === 'pr' ? 'PR' : 'Review'}
          </button>
        ))}
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto py-1.5 space-y-0.5 px-0.5">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 px-3 text-center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-muted-foreground/20">
              <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 13H8.061l-2.574 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Z"/>
            </svg>
            <p className="text-[10px] text-muted-foreground/30">No sessions yet</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {sessions.map(s => (
              <SessionRow
                key={s.id}
                session={s}
                isActive={s.id === activeSessionId}
                onSelect={onSelect}
                onDeleteRequest={handleDeleteRequest}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Confirm delete modal */}
      {deletePending && (
        <ConfirmDeleteModal
          session={deletePending}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </div>
  );
}
