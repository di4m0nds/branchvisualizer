import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '@/store/AppContext';
import { ResizeHandle } from '@/components/workspace/ResizeHandle';
import TabWorkspace from '@/components/workspace/TabWorkspace';
import TerminalDock from '@/components/terminal/TerminalDock';
import ChatPanel from '@/components/agent/ChatPanel';
import ChatConfigStrip from './ChatConfigStrip';
import BvConfigStrip from './BvConfigStrip';
import ProjectsSidebar from './sidebar/ProjectsSidebar';
import { sessionProjectKey, type Session } from '@/types/session';
import { useActiveSession } from '@/hooks/useActiveSession';
import { useRepoData } from '@/hooks/useRepoData';
import { getCachedRepo } from '@/lib/repoCache';
import { loadIdeLayout, saveIdeLayout, type IdeLayout } from '@/lib/ideLayout';

// ─── IDE workspace (fixed 3-zone chrome) ─────────────────────────────────────

// Does the app-global repo currently loaded match this session's repo?
function matchesRef(state: ReturnType<typeof useAppContext>['state'], s: Session): boolean {
  if (!state.graphData) return false;
  if (s.repoSource === 'local') return state.source === 'local' && state.localPath === s.cwd;
  return state.repoInfo?.fullName === s.repoRef;
}

export default function IdeWorkspace() {
  const { state, dispatch } = useAppContext();
  const { graphData } = state;
  const active = useActiveSession();
  const { loadLocalRepo } = useRepoData();

  // Panel sizes + collapse state (persisted; see src/lib/ideLayout.ts).
  const [layout, setLayout] = useState<IdeLayout>(loadIdeLayout);
  const { sidebarWidth, midWidth, dockHeight, cfgCollapsed, bvCollapsed } = layout;
  const setLayoutKey = <K extends keyof IdeLayout>(key: K, val: IdeLayout[K]) =>
    setLayout((l) => ({ ...l, [key]: val }));

  const outerRowRef = useRef<HTMLDivElement>(null);  // sidebar | (middle+right) row
  const rootRowRef = useRef<HTMLDivElement>(null);   // middle|right row (existing handle)
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

  return (
    <div ref={outerRowRef} className="flex flex-1 min-h-0 overflow-hidden">
      {/* Sidebar (resizable). Hard px clamps keep it usable at any drag width. */}
      <div
        className="flex min-w-[180px] max-w-[420px] min-h-0"
        style={{ flex: `0 0 ${sidebarWidth}%` }}
      >
        <ProjectsSidebar />
      </div>

      <ResizeHandle
        direction="h"
        containerRef={outerRowRef}
        size={sidebarWidth}
        onSizeChange={(s) => setLayoutKey('sidebarWidth', s)}
        min={12}
        max={35}
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
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
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
