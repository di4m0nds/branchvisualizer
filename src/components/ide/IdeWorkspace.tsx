import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/store/AppContext';
import { cn } from '@/lib/utils';
import { ResizeHandle } from '@/components/workspace/ResizeHandle';
import TabWorkspace from '@/components/workspace/TabWorkspace';
import TerminalDock from '@/components/terminal/TerminalDock';
import ChatPanel from '@/components/agent/ChatPanel';
import SessionContextBar from './SessionContextBar';
import ModelPicker from './ModelPicker';
import { createDefaultContext, nextId, type Session } from '@/types/session';
import { fetchStatus } from '@/lib/localGit';
import { useActiveSession } from '@/hooks/useActiveSession';

// ─── Session switcher (left rail) ────────────────────────────────────────────

function SessionRail({
  sessions, activeId, onSelect, onClose, onNew,
}: {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex flex-col w-52 flex-shrink-0 border-r border-border bg-muted/10">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sessions</span>
        <button
          onClick={onNew}
          className="h-5 w-5 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          title="New session"
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {sessions.length === 0 && (
          <p className="text-[11px] text-muted-foreground/60 px-2 py-3 leading-relaxed">
            No sessions yet. Click <span className="font-mono">+</span> to start one bound to the current repository.
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={cn(
              'group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
              s.id === activeId ? 'bg-accent/50 text-foreground' : 'text-muted-foreground hover:bg-accent/30',
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
              s.context.status === 'error' ? 'bg-red-400'
                : s.context.status === 'idle' ? 'bg-muted-foreground/40'
                  : 'bg-green-400')} />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-medium truncate">{s.title}</span>
              <span className="text-[10px] text-muted-foreground/60 truncate font-mono">{s.repoRef}</span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(s.id); }}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              title="Close session"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-border">
        <Link to="/" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">← Back to visualizer</Link>
      </div>
    </div>
  );
}

// ─── IDE workspace (fixed 3-zone chrome) ─────────────────────────────────────

export default function IdeWorkspace() {
  const { state, dispatch } = useAppContext();
  const { sessions, activeSessionId, repoInfo, graphData } = state;
  const active = useActiveSession();

  // Zone sizes (percentages).
  const [chatWidth, setChatWidth] = useState(32); // right rail width %
  const [dockHeight, setDockHeight] = useState(28); // bottom dock height %
  const centerRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  function newSession() {
    const repoRef = state.source === 'local'
      ? (state.localPath ?? 'local')
      : (repoInfo ? repoInfo.fullName : 'untitled');
    const title = repoInfo?.repo
      ?? (state.localPath ? state.localPath.split('/').pop() ?? 'local' : 'Session');
    const session: Session = {
      id: nextId('session'),
      title: title || 'Session',
      repoSource: state.source,
      repoRef,
      cwd: state.source === 'local' ? state.localPath : null,
      context: createDefaultContext(),
      messages: [],
      terminals: [],
    };
    dispatch({ type: 'CREATE_SESSION', session });

    // Best-effort: populate the session's git context (desktop + local only).
    if (session.repoSource === 'local' && session.cwd) {
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

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <SessionRail
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={(id) => dispatch({ type: 'SET_ACTIVE_SESSION', id })}
        onClose={(id) => dispatch({ type: 'CLOSE_SESSION', id })}
        onNew={newSession}
      />

      {!active ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Select or create a session to begin.
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Center + terminal dock stack */}
          <div ref={stackRef} className="flex flex-col flex-1 min-w-0 min-h-0">
            <SessionContextBar session={active} />

            {/* Center repo views */}
            <div ref={centerRef} className="flex-1 min-h-0 overflow-hidden" style={{ height: `${100 - dockHeight}%` }}>
              {graphData ? (
                <TabWorkspace />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground text-center px-6">
                  <div>
                    <p className="mb-2">No repository loaded in this session.</p>
                    <Link to="/" className="text-primary hover:underline">Open one from the visualizer →</Link>
                  </div>
                </div>
              )}
            </div>

            {/* Terminal dock (filled in M3) */}
            <ResizeHandle
              direction="v"
              containerRef={stackRef}
              size={100 - dockHeight}
              onSizeChange={(s) => setDockHeight(100 - s)}
              min={10}
              max={70}
            />
            <div className="flex-shrink-0 border-t border-border bg-background" style={{ height: `${dockHeight}%` }}>
              <TerminalDock key={active.id} sessionId={active.id} cwd={active.cwd ?? '.'} />
            </div>
          </div>

          {/* Chat rail (filled in M4) */}
          <ResizeHandle
            direction="h"
            containerRef={stackRef}
            size={100 - chatWidth}
            onSizeChange={(s) => setChatWidth(100 - s)}
            min={20}
            max={60}
          />
          <div className="flex-shrink-0 border-l border-border bg-muted/5 flex flex-col" style={{ width: `${chatWidth}%` }}>
            <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Agent</span>
              <ModelPicker />
            </div>
            <div className="flex-1 min-h-0">
              <ChatPanel key={active.id} session={active} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
