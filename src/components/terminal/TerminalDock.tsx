import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { swallow } from '@/lib/log';
import { TerminalSquare, FileCode, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/platform';
import Terminal from './Terminal';
import { nextId } from '@/types/session';
import type { TerminalDef } from '@/types/terminal';
import { subscribeOpenInNvim } from '@/hooks/useOpenInNvim';
import { usePanelZoom } from '@/hooks/usePanelFocus';
import { PanelMaximizeButton } from '@/components/ide/FocusablePanel';

const MAX_SHELLS = 4;

function makeNvim(cwd: string): TerminalDef {
  return { id: nextId('term'), role: 'nvim', title: 'nvim', cwd, cmd: 'nvim' };
}

// Shell titles are numbered off the live shell list ("Shell", "Shell 2", ...).
// Renames replace the title but don't shift the numbering of future shells.
function makeShell(cwd: string, existing: TerminalDef[]): TerminalDef {
  const n = existing.length;
  const title = n === 0 ? 'Shell' : `Shell ${n + 1}`;
  return { id: nextId('term'), role: 'shell', title, cwd };
}

/**
 * Tabbed terminal dock. Left side is a permanent nvim tab (auto-respawns on
 * `:q` by bumping `nvimBootId`, which changes the pane key). Right side is up
 * to MAX_SHELLS renameable shell tabs plus a "+" button that hides at cap.
 * Terminals stay mounted when hidden so their PTYs survive tab switches;
 * killing on close/unmount prevents zombies. The `open-in-nvim` bus routes
 * `:e <path>` straight to the singleton — no lookup, no fallback spawn.
 */
// Memoized: mounted next to the chat, whose streaming re-renders the parent
// ~30×/s. With stable props (see IdeWorkspace's useCallback toggle) memo makes
// those re-renders free — critical, since this hosts live xterm/PTY instances.
export default memo(function TerminalDock({
  cwd,
  sessionId,
  collapsed = false,
  onToggleCollapsed,
}: {
  cwd: string;
  sessionId: string;
  /** When true the dock shows only its tab strip (panes clipped to 0 height). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const fontScale = usePanelZoom('terminal');
  const [nvim] = useState<TerminalDef>(() => makeNvim(cwd));
  const [nvimBootId, setNvimBootId] = useState(0);
  const [shells, setShells] = useState<TerminalDef[]>([]);
  const [activeId, setActiveId] = useState<string>(nvim.id);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Mirror of `shells` for synchronous reads inside `addShell` (numbering the
  // new tab off the live list without threading it through the updater).
  const shellsRef = useRef<TerminalDef[]>(shells);
  shellsRef.current = shells;

  // Registered per-terminal writers so we can send ex-commands (`:e path\r`)
  // to the running nvim without a round-trip through Tauri events.
  const writersRef = useRef<Record<string, (data: string) => Promise<void>>>({});

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  // Selecting a tab while the dock is collapsed also expands it — otherwise the
  // click would silently switch a pane the user can't see.
  const selectTab = useCallback((id: string) => {
    setActiveId(id);
    if (collapsed) onToggleCollapsed?.();
  }, [collapsed, onToggleCollapsed]);

  const addShell = useCallback(() => {
    if (shellsRef.current.length >= MAX_SHELLS) return;
    const t = makeShell(cwd, shellsRef.current);
    setShells((prev) => [...prev, t]);
    setActiveId(t.id);
    if (collapsed) onToggleCollapsed?.();
  }, [cwd, collapsed, onToggleCollapsed]);

  const closeShell = useCallback((id: string) => {
    delete writersRef.current[id];
    setShells((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (id === activeId) {
        const fallback = next[idx - 1] ?? next[0] ?? null;
        setActiveId(fallback ? fallback.id : nvim.id);
      }
      return next;
    });
    if (renamingId === id) setRenamingId(null);
  }, [activeId, nvim.id, renamingId]);

  const startRename = useCallback((tab: TerminalDef) => {
    setRenameValue(tab.title);
    setRenamingId(tab.id);
  }, []);

  const commitRename = useCallback(() => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    setShells((prev) => prev.map((t) => (
      t.id === renamingId && trimmed ? { ...t, title: trimmed } : t
    )));
    setRenamingId(null);
  }, [renamingId, renameValue]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  // Nvim's PTY exited (usually `:q`/`:wq`). Bump the boot id to force a
  // remount of the pane — the stable nvim.id means the new Terminal
  // re-registers its writer at the same key, so the open-in-nvim bus keeps
  // working transparently.
  const handleNvimExit = useCallback(() => {
    setNvimBootId((x) => x + 1);
  }, []);

  // Open-in-nvim bus: send `:e <path>` to the singleton nvim.
  useEffect(() => {
    if (!isTauri()) return;
    return subscribeOpenInNvim(sessionId, async ({ path }) => {
      setActiveId(nvim.id);
      const writer = writersRef.current[nvim.id];
      if (!writer) return;
      const escaped = path.replace(/ /g, '\\ ');
      await writer(`\x1b:e ${escaped}\r`).catch(swallow('pty', 'nvim open-file escape'));
    });
  }, [sessionId, nvim.id]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Tab strip */}
      <div className="flex items-center gap-1 px-1.5 h-8 border-b border-border bg-muted/20 flex-shrink-0">
        <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-hide">
          {/* Nvim singleton — no X, no rename */}
          <button
            key={nvim.id}
            onClick={() => selectTab(nvim.id)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono transition-colors flex-shrink-0 border',
              activeId === nvim.id
                ? 'bg-background text-foreground border-border shadow-sm'
                : 'text-muted-foreground hover:text-foreground border-transparent hover:bg-accent/30',
            )}
          >
            <FileCode className="w-3 h-3 flex-shrink-0 text-green-400" />
            <span className="select-none">nvim</span>
          </button>

          {/* Divisor between nvim and shells */}
          <div className="w-px h-4 bg-border/60 mx-1 flex-shrink-0" />

          {/* Shell tabs */}
          {shells.map((t) => {
            const renaming = renamingId === t.id;
            const active = t.id === activeId;
            return (
              <div
                key={t.id}
                onClick={() => !renaming && selectTab(t.id)}
                className={cn(
                  'group flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-md text-[11px] font-mono transition-colors flex-shrink-0 border cursor-pointer',
                  active
                    ? 'bg-background text-foreground border-border shadow-sm'
                    : 'text-muted-foreground hover:text-foreground border-transparent hover:bg-accent/30',
                )}
              >
                <TerminalSquare className="w-3 h-3 flex-shrink-0" />
                {renaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                    }}
                    className="min-w-0 w-24 bg-background border border-border rounded px-1 py-0 text-[11px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => { e.stopPropagation(); startRename(t); }}
                    className="truncate max-w-32 select-none"
                    title="Double-click to rename"
                  >
                    {t.title}
                  </span>
                )}
                <span
                  onClick={(e) => { e.stopPropagation(); closeShell(t.id); }}
                  className="flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-destructive rounded-sm"
                  title="Close terminal"
                >
                  <X className="w-3 h-3" />
                </span>
              </div>
            );
          })}

          {/* Add-shell button — hides when at cap */}
          {shells.length < MAX_SHELLS && (
            <button
              onClick={addShell}
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors font-mono flex-shrink-0"
              title="New shell"
            >
              <Plus className="w-3 h-3" />
              <TerminalSquare className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Right-side panel controls: maximize + collapse. Static so they never
            overlap the tab strip on the left. */}
        <div className="ml-auto flex items-center gap-0.5 flex-shrink-0">
          <PanelMaximizeButton id="terminal" />
          {onToggleCollapsed && (
            <button
              onClick={onToggleCollapsed}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
              title={collapsed ? 'Expand terminal' : 'Collapse terminal'}
            >
              {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Terminal panes — all mounted (PTYs survive), clipped to 0 when collapsed. */}
      <div className={cn('relative flex-1 min-h-0', collapsed && 'hidden')}>
        <div
          key={`${nvim.id}:${nvimBootId}`}
          className={cn('absolute inset-0 p-1.5', activeId !== nvim.id && 'invisible pointer-events-none')}
        >
          <Terminal
            def={nvim}
            active={activeId === nvim.id}
            fontScale={fontScale}
            onExit={handleNvimExit}
            registerWriter={(w) => { writersRef.current[nvim.id] = w; }}
          />
        </div>
        {shells.map((t) => (
          <div
            key={t.id}
            className={cn('absolute inset-0 p-1.5', t.id !== activeId && 'invisible pointer-events-none')}
          >
            <Terminal
              def={t}
              active={t.id === activeId}
              fontScale={fontScale}
              registerWriter={(w) => { writersRef.current[t.id] = w; }}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
