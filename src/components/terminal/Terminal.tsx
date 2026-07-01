import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { isTauri, type Unlisten } from '@/lib/platform';
import { spawnPty, writePty, resizePty, killPty, onPtyData, onPtyExit } from '@/lib/pty';
import { useAppContext } from '@/store/AppContext';
import type { TerminalDef } from '@/types/terminal';

const DARK_THEME = {
  background: '#0a0a0a', foreground: '#e4e4e7', cursor: '#e4e4e7',
  cursorAccent: '#0a0a0a', selectionBackground: '#3f3f46',
  black: '#18181b', red: '#f87171', green: '#4ade80', yellow: '#facc15',
  blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e4e4e7',
  brightBlack: '#52525b', brightRed: '#fca5a5', brightGreen: '#86efac',
  brightYellow: '#fde047', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9', brightWhite: '#fafafa',
};
const LIGHT_THEME = {
  background: '#ffffff', foreground: '#18181b', cursor: '#18181b',
  cursorAccent: '#ffffff', selectionBackground: '#e4e4e7',
  black: '#18181b', red: '#dc2626', green: '#16a34a', yellow: '#ca8a04',
  blue: '#2563eb', magenta: '#9333ea', cyan: '#0891b2', white: '#f4f4f5',
  brightBlack: '#52525b', brightRed: '#ef4444', brightGreen: '#22c55e',
  brightYellow: '#eab308', brightBlue: '#3b82f6', brightMagenta: '#a855f7',
  brightCyan: '#06b6d4', brightWhite: '#fafafa',
};

export interface TerminalHandle {
  writeLine(text: string): void;
}

/**
 * A single xterm terminal bound to a Rust PTY. Handles the full lifecycle:
 * spawn → stream → resize → kill-on-unmount (no zombies). Output is written as
 * raw bytes so xterm owns UTF-8 decoding. Desktop-only; renders a placeholder in
 * the browser. The optional `onExit` fires when the PTY child exits (used by
 * TerminalDock to close nvim tabs when the user runs `:q`/`:wq`).
 */
export default function Terminal({
  def,
  active = true,
  onExit,
  registerWriter,
}: {
  def: TerminalDef;
  /** Whether this terminal's tab is currently visible. Drives refit-on-show. */
  active?: boolean;
  onExit?: (code: number | null) => void;
  registerWriter?: (write: (data: string) => Promise<void>) => void;
}) {
  const { state } = useAppContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef(state.theme);
  themeRef.current = state.theme;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const registerWriterRef = useRef(registerWriter);
  registerWriterRef.current = registerWriter;
  // Held so a separate effect can refit when the tab becomes visible.
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!isTauri() || !containerRef.current) return;

    const term = new XTerm({
      fontFamily: 'ui-monospace, "Geist Mono", "SFMono-Regular", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeRef.current === 'dark' ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    try { fit.fit(); } catch { /* container not laid out yet */ }

    const id = def.id;
    let disposed = false;
    let unlistenData: Unlisten = () => {};
    let unlistenExit: Unlisten = () => {};

    const dataDisposable = term.onData((d) => {
      writePty(id, d).catch(() => {});
    });

    registerWriterRef.current?.((data: string) => writePty(id, data));

    (async () => {
      unlistenData = await onPtyData(id, (bytes) => { if (!disposed) term.write(bytes); });
      unlistenExit = await onPtyExit(id, (code) => {
        if (disposed) return;
        term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n');
        onExitRef.current?.(code);
      });
      await spawnPty({ id, cmd: def.cmd, args: def.args, cwd: def.cwd, cols: term.cols, rows: term.rows });
      // If the component unmounted while spawn was in flight (StrictMode double
      // mount, fast tab close), tear the just-spawned PTY down so it can't
      // survive as an orphan echoing a second prompt.
      if (disposed) { void killPty(id); }
    })().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      term.write(`\r\n\x1b[31m[failed to start: ${msg}]\x1b[0m\r\n`);
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        resizePty(id, term.cols, term.rows).catch(() => {});
      } catch { /* noop */ }
    });
    ro.observe(containerRef.current);

    return () => {
      disposed = true;
      ro.disconnect();
      dataDisposable.dispose();
      unlistenData();
      unlistenExit();
      killPty(id).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);

  // Refit when this tab becomes visible: hidden panes fit to a stale/zero size,
  // so a terminal opened while the dock was small renders cramped until shown.
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => {
      const term = termRef.current, fit = fitRef.current;
      if (!term || !fit) return;
      try {
        fit.fit();
        resizePty(def.id, term.cols, term.rows).catch(() => {});
      } catch { /* not laid out yet */ }
    });
    return () => cancelAnimationFrame(raf);
  }, [active, def.id]);

  if (!isTauri()) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground/60 text-center px-4">
        Terminals require the desktop app. Run <code className="mx-1 font-mono">pnpm tauri dev</code>.
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
