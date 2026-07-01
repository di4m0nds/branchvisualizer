import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/store/AppContext';
import { cn } from '@/lib/utils';
import { ResizeHandle } from '@/components/workspace/ResizeHandle';
import TabWorkspace from '@/components/workspace/TabWorkspace';
import TerminalDock from '@/components/terminal/TerminalDock';
import ChatPanel from '@/components/agent/ChatPanel';
import ChatConfigStrip from './ChatConfigStrip';
import BvConfigStrip from './BvConfigStrip';
import { createDefaultContext, nextId, sessionProjectKey, type Session } from '@/types/session';
import { fetchStatus } from '@/lib/localGit';
import { useActiveSession } from '@/hooks/useActiveSession';
import { useRepoData } from '@/hooks/useRepoData';
import { getCachedRepo } from '@/lib/repoCache';
import { loadIdeLayout, saveIdeLayout, type IdeLayout } from '@/lib/ideLayout';
import { loadAgentDefaults } from '@/lib/agentDefaults';

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

// Does the app-global repo currently loaded match this session's repo?
function matchesRef(state: ReturnType<typeof useAppContext>['state'], s: Session): boolean {
  if (!state.graphData) return false;
  if (s.repoSource === 'local') return state.source === 'local' && state.localPath === s.cwd;
  return state.repoInfo?.fullName === s.repoRef;
}

export default function IdeWorkspace() {
  const { state, dispatch } = useAppContext();
  const { sessions, activeSessionId, repoInfo, graphData } = state;
  const active = useActiveSession();
  const { loadLocalRepo } = useRepoData();

  // Panel sizes + collapse state (persisted; see src/lib/ideLayout.ts).
  const [layout, setLayout] = useState<IdeLayout>(loadIdeLayout);
  const { midWidth, dockHeight, cfgCollapsed, bvCollapsed } = layout;
  const setLayoutKey = <K extends keyof IdeLayout>(key: K, val: IdeLayout[K]) =>
    setLayout((l) => ({ ...l, [key]: val }));

  const rootRowRef = useRef<HTMLDivElement>(null);   // outer middle|right row (horizontal handle)
  const agentStackRef = useRef<HTMLDivElement>(null); // chat/terminal stack (vertical handle)

  // Debounced persist so a drag (fires per mousemove) doesn't hammer localStorage.
  useEffect(() => {
    const t = setTimeout(() => saveIdeLayout(layout), 250);
    return () => clearTimeout(t);
  }, [layout]);

  // Per-session repo view: swap the graph to the active session's repo. Reuses
  // the cache for an instant swap, else loads a local repo via the existing
  // path. Idempotent (matchesRef early-out) so StrictMode's double-invoke is a
  // no-op and switching back to an already-shown repo doesn't reload.
  useEffect(() => {
    if (!active) return;
    if (matchesRef(state, active)) return;

    const cached = getCachedRepo(active.repoRef);
    if (cached) {
      dispatch({ type: 'SET_SOURCE', source: cached.source, localPath: active.cwd });
      dispatch({
        type: 'LOAD_SUCCESS',
        repoInfo: cached.repoInfo,
        graphData: cached.graphData,
        branches: cached.branches,
        tags: cached.tags,
        allCommits: cached.allCommits,
        rawCommits: cached.rawCommits,
      });
      return;
    }
    const busy = !['idle', 'error', 'done'].includes(state.loadState.phase);
    if (active.repoSource === 'local' && active.cwd && !busy) {
      void loadLocalRepo(active.cwd);
    }
    // GitHub sessions with no cache keep the empty state (memory cache is lost
    // on reload); reopen from the visualizer to repopulate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  function newSession() {
    const repoRef = state.source === 'local'
      ? (state.localPath ?? 'local')
      : (repoInfo ? repoInfo.fullName : 'untitled');
    const title = repoInfo?.repo
      ?? (state.localPath ? state.localPath.split('/').pop() ?? 'local' : 'Session');
    const defaults = loadAgentDefaults();
    const session: Session = {
      id: nextId('session'),
      title: title || 'Session',
      repoSource: state.source,
      repoRef,
      cwd: state.source === 'local' ? state.localPath : null,
      context: { ...createDefaultContext(), accessLevel: defaults.accessLevel, buildMode: defaults.buildMode },
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
        <div ref={rootRowRef} className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── MIDDLE column: agent chat (top) + terminal dock (bottom) ── */}
          <div
            className="flex flex-col min-w-0 min-h-0 bg-muted/5"
            style={{ flex: `0 0 ${midWidth}%` }}
          >
            <ChatConfigStrip
              session={active}
              collapsed={cfgCollapsed}
              onToggle={() => setLayoutKey('cfgCollapsed', !cfgCollapsed)}
            />
            <div ref={agentStackRef} className="flex flex-col flex-1 min-h-0">
              {/* Chat pane (remainder) */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <ChatPanel key={active.id} session={active} />
              </div>

              <ResizeHandle
                direction="v"
                containerRef={agentStackRef}
                size={100 - dockHeight}
                onSizeChange={(s) => setLayoutKey('dockHeight', 100 - s)}
                min={12}
                max={75}
              />

              {/* Terminal dock (sized). Keyed by PROJECT, not session, so
                  switching sessions within the same repo keeps the shells,
                  server, and nvim alive — only the agent view (ChatPanel, keyed
                  by session id) hot-swaps. A different project remounts it. */}
              <div
                className="min-h-0 overflow-hidden border-t border-border bg-background"
                style={{ flex: `0 0 ${dockHeight}%` }}
              >
                <TerminalDock key={sessionProjectKey(active)} sessionId={active.id} cwd={active.cwd ?? '.'} />
              </div>
            </div>
          </div>

          <ResizeHandle
            direction="h"
            containerRef={rootRowRef}
            size={midWidth}
            onSizeChange={(s) => setLayoutKey('midWidth', s)}
            min={25}
            max={70}
          />

          {/* ── RIGHT column: BranchVisualizer ── */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0 border-l border-border">
            <BvConfigStrip
              collapsed={bvCollapsed}
              onToggle={() => setLayoutKey('bvCollapsed', !bvCollapsed)}
            />
            <div className="flex-1 min-h-0 overflow-hidden">
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
          </div>
        </div>
      )}
    </div>
  );
}
