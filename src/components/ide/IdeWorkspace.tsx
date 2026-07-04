import { useCallback, useEffect, useRef, useState } from 'react';
import StatusBar from './StatusBar';
import DebugPanel from './debug/DebugPanel';
import { Link } from 'react-router-dom';
import { getAppState, useAppDispatch, useAppSelector } from '@/store/store';
import type { AppState } from '@/types';
import { ResizeHandle } from '@/components/workspace/ResizeHandle';
import TabWorkspace from '@/components/workspace/TabWorkspace';
import TerminalDock from '@/components/terminal/TerminalDock';
import ChatPanel from '@/components/agent/ChatPanel';
import ChatConfigStrip from './ChatConfigStrip';
import BvConfigStrip from './BvConfigStrip';
import ProjectsSidebar from './sidebar/ProjectsSidebar';
import FocusablePanel from './FocusablePanel';
import PlanView from './plan/PlanView';
import RuntimePanel from './runtime/RuntimePanel';
import LocalDocsTab from '@/components/workspace/LocalDocsTab';
import { sessionProjectKey, type Session } from '@/types/session';
import { latestPlanText, sessionHasPlan } from '@/lib/agent/plan';
import { useActiveSession } from '@/hooks/useActiveSession';
import { useRepoData } from '@/hooks/useRepoData';
import { registerRightViewSetter } from '@/hooks/useSetRightView';
import { getCachedRepo } from '@/lib/repoCache';
import { loadIdeLayout, saveIdeLayout, type IdeLayout } from '@/lib/ideLayout';
import { useFocusedPanelZoom } from '@/hooks/useFocusedPanelZoom';
import { usePanelShortcuts } from '@/hooks/usePanelShortcuts';
import { registerShowPanel } from '@/hooks/usePanelVisibility';

// ─── IDE workspace (fixed 3-zone chrome) ─────────────────────────────────────

// Does the app-global repo currently loaded match this session's repo?
function matchesRef(state: AppState, s: Session): boolean {
  if (!state.graphData) return false;
  if (s.repoSource === 'local') return state.source === 'local' && state.localPath === s.cwd;
  return state.repoInfo?.fullName === s.repoRef;
}

export default function IdeWorkspace() {
  const dispatch = useAppDispatch();
  // Only graphData is a render dependency; everything else the workspace needs
  // (viewport, loadState) is read non-reactively at event time via getAppState.
  const graphData = useAppSelector((s) => s.graphData);
  const active = useActiveSession();
  const { loadLocalRepo } = useRepoData();

  // Panel sizes + collapse state (persisted; see src/lib/ideLayout.ts).
  const [layout, setLayout] = useState<IdeLayout>(loadIdeLayout);
  const {
    sidebarWidth, midWidth, dockHeight, cfgCollapsed, bvCollapsed,
    sidebarCollapsed, dockCollapsed, rightView,
  } = layout;
  const setLayoutKey = <K extends keyof IdeLayout>(key: K, val: IdeLayout[K]) =>
    setLayout((l) => ({ ...l, [key]: val }));
  // Stable toggle so the memoized TerminalDock's props don't change when this
  // component re-renders on streamed tokens.
  const toggleDockCollapsed = useCallback(
    () => setLayout((l) => ({ ...l, dockCollapsed: !l.dockCollapsed })),
    [],
  );

  const outerRowRef = useRef<HTMLDivElement>(null);  // sidebar | (middle+right) row
  const rootRowRef = useRef<HTMLDivElement>(null);   // middle|right row (existing handle)
  const agentStackRef = useRef<HTMLDivElement>(null); // chat/terminal stack (vertical handle)

  // Debounced persist so a drag (fires per mousemove) doesn't hammer localStorage.
  // Preserve `docsSidebarWidth` from disk on write: LocalDocsTab owns that
  // field, and our in-memory copy would be stale after the user drags the docs
  // handle. Every other field lives here, so `...layout` wins for the rest.
  useEffect(() => {
    const t = setTimeout(() => {
      const disk = loadIdeLayout();
      saveIdeLayout({ ...layout, docsSidebarWidth: disk.docsSidebarWidth });
    }, 250);
    return () => clearTimeout(t);
  }, [layout]);

  // Register a cross-panel setter so the chat's docked plan strip can swap
  // the right column to Plan (or back to Canvas/Runtime) without threading
  // callbacks. Kept in sync with the layout via `setLayoutKey`.
  useEffect(() => {
    // setLayoutKey closes over `setLayout` (from useState) which is stable, so
    // a single registration is safe for the panel's lifetime.
    return registerRightViewSetter((v) => setLayoutKey('rightView', v));
  }, []);

  // Register the "make this panel visible" handler so keyboard shortcuts (and
  // any future cross-panel affordance) can uncollapse the sidebar/dock or
  // swap the right column before focusing a panel — otherwise focusing an
  // unmounted panel silently succeeds and the follow-up maximize blanks the
  // screen (workspace/plan/runtime share one slot via `rightView`).
  useEffect(() => {
    return registerShowPanel((id) => {
      if (id === 'sidebar') setLayoutKey('sidebarCollapsed', false);
      else if (id === 'terminal') setLayoutKey('dockCollapsed', false);
      else if (id === 'workspace' || id === 'plan' || id === 'runtime' || id === 'docs' || id === 'debug') setLayoutKey('rightView', id);
      // 'chat' is always mounted → no-op.
    });
  }, []);

  // Ctrl +/-/0 on the focused panel. When the workspace is focused, delegate to
  // the graph's viewport zoom (CSS zoom would distort the canvas).
  const onWorkspaceZoom = useCallback((cmd: 'in' | 'out' | 'reset') => {
    const { scale, offsetX, offsetY } = getAppState().viewport;
    if (cmd === 'in') dispatch({ type: 'SET_VIEWPORT', viewport: { scale: Math.min(3, scale * 1.2), offsetX, offsetY } });
    else if (cmd === 'out') dispatch({ type: 'SET_VIEWPORT', viewport: { scale: Math.max(0.15, scale * 0.8), offsetX, offsetY } });
    else dispatch({ type: 'SET_VIEWPORT', viewport: { scale: 1, offsetX: 16, offsetY: 16 } });
  }, [dispatch]);
  useFocusedPanelZoom(onWorkspaceZoom);
  // Alt+1..6 focuses a panel; Alt+F toggles maximize on the focused panel.
  usePanelShortcuts();

  // Per-session repo view: swap the graph to the active session's repo. Reuses
  // the cache for an instant swap, else loads a local repo via the existing
  // path. Idempotent (matchesRef early-out) so StrictMode's double-invoke is a
  // no-op and switching back to an already-shown repo doesn't reload.
  useEffect(() => {
    if (!active) return;
    if (matchesRef(getAppState(), active)) return;

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
    const busy = !['idle', 'error', 'done'].includes(getAppState().loadState.phase);
    if (active.repoSource === 'local' && active.cwd && !busy) {
      void loadLocalRepo(active.cwd);
    }
    // GitHub sessions with no cache keep the empty state (memory cache is lost
    // on reload); reopen from the visualizer to repopulate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // Auto-focus the Plan view whenever a NEW plan lands. Ref-guarded by the
  // plan's messageId so the user can manually flip back to Canvas/Runtime and
  // stay there — only a new plan (different id) re-triggers the swap.
  const planKey = active ? latestPlanText(active)?.messageId ?? null : null;
  const lastAutoFocusedPlanRef = useRef<string | null>(null);
  useEffect(() => {
    if (!planKey || planKey === lastAutoFocusedPlanRef.current) return;
    lastAutoFocusedPlanRef.current = planKey;
    setLayoutKey('rightView', 'plan');
  }, [planKey]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
    <div ref={outerRowRef} className="flex flex-1 min-h-0 overflow-hidden">
      {/* Sidebar. Collapses to a fixed icon rail; otherwise resizable with hard
          px clamps so it stays usable at any drag width. */}
      {sidebarCollapsed ? (
        <div className="flex flex-none min-h-0">
          <ProjectsSidebar
            railCollapsed
            onToggleRail={() => setLayoutKey('sidebarCollapsed', false)}
          />
        </div>
      ) : (
        <>
          <div
            className="flex min-w-[180px] max-w-[420px] min-h-0"
            style={{ flex: `0 0 ${sidebarWidth}%` }}
          >
            <ProjectsSidebar onToggleRail={() => setLayoutKey('sidebarCollapsed', true)} />
          </div>

          <ResizeHandle
            direction="h"
            containerRef={outerRowRef}
            size={sidebarWidth}
            onSizeChange={(s) => setLayoutKey('sidebarWidth', s)}
            min={12}
            max={35}
          />
        </>
      )}

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
            <div ref={agentStackRef} className="flex flex-col flex-1 min-h-0">
              {/* Chat pane (remainder). The config strip lives INSIDE the
                  focusable panel so a maximized chat keeps the model picker,
                  branch indicator, and session controls reachable. */}
              <FocusablePanel id="chat" className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <ChatConfigStrip
                  session={active}
                  collapsed={cfgCollapsed}
                  onToggle={() => setLayoutKey('cfgCollapsed', !cfgCollapsed)}
                />
                <div className="flex-1 min-h-0 overflow-hidden">
                  <ChatPanel key={active.id} session={active} />
                </div>
              </FocusablePanel>

              {!dockCollapsed && (
                <ResizeHandle
                  direction="v"
                  containerRef={agentStackRef}
                  size={100 - dockHeight}
                  onSizeChange={(s) => setLayoutKey('dockHeight', 100 - s)}
                  min={12}
                  max={75}
                />
              )}

              {/* Terminal dock. Keyed by PROJECT, not session, so switching
                  sessions within the same repo keeps the shells, server, and
                  nvim alive — only the agent view (ChatPanel, keyed by session
                  id) hot-swaps. A different project remounts it. When collapsed
                  the dock shrinks to just its tab strip (panes stay mounted). */}
              <div
                className="flex flex-col min-h-0 overflow-hidden border-t border-border bg-background flex-none"
                style={dockCollapsed ? undefined : { flex: `0 0 ${dockHeight}%` }}
              >
                <FocusablePanel id="terminal" className="flex-1 min-h-0">
                  <TerminalDock
                    key={sessionProjectKey(active)}
                    sessionId={active.id}
                    cwd={active.cwd ?? '.'}
                    collapsed={dockCollapsed}
                    onToggleCollapsed={toggleDockCollapsed}
                  />
                </FocusablePanel>
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

          {/* ── RIGHT column: BranchVisualizer canvas ↔ Implementation Plan.
              The switch strip is rendered INSIDE the focusable panel so it
              stays visible when the panel is maximized (its maximize button
              remains reachable to restore). ── */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0 border-l border-border">
            {rightView === 'plan' ? (
              <FocusablePanel id="plan" className="flex-1 min-h-0 overflow-hidden">
                <BvConfigStrip
                  collapsed={bvCollapsed}
                  onToggle={() => setLayoutKey('bvCollapsed', !bvCollapsed)}
                  view={rightView}
                  onViewChange={(v) => setLayoutKey('rightView', v)}
                  hasPlan={sessionHasPlan(active)}
                />
                <PlanView session={active} />
              </FocusablePanel>
            ) : rightView === 'runtime' ? (
              <FocusablePanel id="runtime" className="flex-1 min-h-0 overflow-hidden">
                <BvConfigStrip
                  collapsed={bvCollapsed}
                  onToggle={() => setLayoutKey('bvCollapsed', !bvCollapsed)}
                  view={rightView}
                  onViewChange={(v) => setLayoutKey('rightView', v)}
                  hasPlan={sessionHasPlan(active)}
                />
                <RuntimePanel />
              </FocusablePanel>
            ) : rightView === 'debug' ? (
              <FocusablePanel id="debug" className="flex-1 min-h-0 overflow-hidden">
                <BvConfigStrip
                  collapsed={bvCollapsed}
                  onToggle={() => setLayoutKey('bvCollapsed', !bvCollapsed)}
                  view={rightView}
                  onViewChange={(v) => setLayoutKey('rightView', v)}
                  hasPlan={sessionHasPlan(active)}
                />
                <DebugPanel />
              </FocusablePanel>
            ) : rightView === 'docs' ? (
              <FocusablePanel id="docs" className="flex-1 min-h-0 overflow-hidden">
                <BvConfigStrip
                  collapsed={bvCollapsed}
                  onToggle={() => setLayoutKey('bvCollapsed', !bvCollapsed)}
                  view={rightView}
                  onViewChange={(v) => setLayoutKey('rightView', v)}
                  hasPlan={sessionHasPlan(active)}
                />
                <LocalDocsTab />
              </FocusablePanel>
            ) : (
              <FocusablePanel id="workspace" className="flex-1 min-h-0 overflow-hidden">
                <BvConfigStrip
                  collapsed={bvCollapsed}
                  onToggle={() => setLayoutKey('bvCollapsed', !bvCollapsed)}
                  view={rightView}
                  onViewChange={(v) => setLayoutKey('rightView', v)}
                  hasPlan={sessionHasPlan(active)}
                />
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
              </FocusablePanel>
            )}
          </div>
        </div>
      )}
    </div>
    {/* Machine vitals — expandable to the full system panel. */}
    <StatusBar />
    </div>
  );
}
