import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { WebglAddon } from 'xterm-addon-webgl';
import { CanvasAddon } from 'xterm-addon-canvas';
import 'xterm/css/xterm.css';
import { isTauri, type Unlisten } from '@/lib/platform';
import { spawnPty, writePty, resizePty, killPty, onPtyData, onPtyExit } from '@/lib/pty';
import { swallow } from '@/lib/log';
import { useAppSelector } from '@/store/store';
import { useSystemFonts } from '@/hooks/useSystemFonts';
import { buildTerminalFontFamily } from '@/lib/terminalFont';
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
const BASE_FONT_SIZE = 13;

export default function Terminal({
  def,
  active = true,
  fontScale = 1,
  onExit,
  registerWriter,
}: {
  def: TerminalDef;
  /** Whether this terminal's tab is currently visible. Drives refit-on-show. */
  active?: boolean;
  /** Per-panel zoom factor applied to the xterm font size. */
  fontScale?: number;
  onExit?: (code: number | null) => void;
  registerWriter?: (write: (data: string) => Promise<void>) => void;
}) {
  // Slice subscriptions — xterm must not re-render on chat/session churn.
  const terminalFont = useAppSelector((s) => s.terminalFont);
  const theme = useAppSelector((s) => s.theme);
  const { nerdFonts } = useSystemFonts();
  const fontFamily = buildTerminalFontFamily(terminalFont, nerdFonts);
  const containerRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const fontFamilyRef = useRef(fontFamily);
  fontFamilyRef.current = fontFamily;
  const fontScaleRef = useRef(fontScale);
  fontScaleRef.current = fontScale;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const registerWriterRef = useRef(registerWriter);
  registerWriterRef.current = registerWriter;
  // Held so a separate effect can refit when the tab becomes visible.
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activePtyIdRef = useRef<string>('');

  useEffect(() => {
    if (!isTauri() || !containerRef.current) return;

    const term = new XTerm({
      fontFamily: fontFamilyRef.current,
      fontSize: Math.round(BASE_FONT_SIZE * fontScaleRef.current),
      lineHeight: 1.2,
      letterSpacing: 0,
      // Cursor is nvim's to drive: guicursor sends DECSCUSR to change shape and
      // blink per mode. Fighting it at the xterm level makes the cursor flicker
      // and occasionally vanish during full-screen redraws.
      cursorBlink: false,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline', // keep cursor visible when tab loses focus
      scrollback: 5000,
      theme: themeRef.current === 'dark' ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
      macOptionIsMeta: true, // Alt-based nvim mappings on macOS
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    try { fit.fit(); } catch { /* container not laid out yet */ }

    // Renderer ladder: WebGL is the sharpest and keeps the cursor synced with
    // nvim's 30-60 Hz redraws; Canvas is a close second; both must load AFTER
    // term.open(). The default DOM renderer stays if both fail (headless CI,
    // GPU blocked, tiny embedded webview).
    let rendererAddon: WebglAddon | CanvasAddon | null = null;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
      rendererAddon = webgl;
    } catch {
      try {
        const canvas = new CanvasAddon();
        term.loadAddon(canvas);
        rendererAddon = canvas;
      } catch { /* fall back to default DOM renderer */ }
    }

    const id = `${def.id}_${Math.random().toString(36).substring(2, 11)}`;
    activePtyIdRef.current = id;
    let disposed = false;
    let unlistenData: Unlisten = () => {};
    let unlistenExit: Unlisten = () => {};

    const dataDisposable = term.onData((d) => {
      writePty(id, d).catch(swallow('pty', 'write'));
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

    // Coalesce resize bursts to one fit per frame — a dock drag fires many
    // ResizeObserver callbacks and refitting xterm on each is expensive.
    let fitRaf = 0;
    const ro = new ResizeObserver(() => {
      if (fitRaf) return;
      fitRaf = requestAnimationFrame(() => {
        fitRaf = 0;
        try {
          fit.fit();
          resizePty(id, term.cols, term.rows).catch(swallow('pty', 'resize'));
        } catch { /* noop */ }
      });
    });
    ro.observe(containerRef.current);

    return () => {
      disposed = true;
      if (fitRaf) cancelAnimationFrame(fitRaf);
      ro.disconnect();
      dataDisposable.dispose();
      unlistenData();
      unlistenExit();
      killPty(id).catch(swallow('pty', 'kill on unmount'));
      rendererAddon?.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);

  // Live font swap when the user picks a new family in Settings. Cell metrics
  // change with the font, so refit + resize the PTY to match the new grid.
  useEffect(() => {
    const term = termRef.current, fit = fitRef.current;
    if (!term || !fit) return;
    term.options.fontFamily = fontFamily;
    try {
      fit.fit();
      if (activePtyIdRef.current) {
        resizePty(activePtyIdRef.current, term.cols, term.rows).catch(swallow('pty', 'resize'));
      }
    } catch { /* container not laid out yet */ }
  }, [fontFamily]);

  // Live font-size swap when the panel zoom changes. Cell metrics change, so
  // refit + resize the PTY to match the new grid (mirrors the fontFamily swap).
  useEffect(() => {
    const term = termRef.current, fit = fitRef.current;
    if (!term || !fit) return;
    term.options.fontSize = Math.round(BASE_FONT_SIZE * fontScale);
    try {
      fit.fit();
      if (activePtyIdRef.current) {
        resizePty(activePtyIdRef.current, term.cols, term.rows).catch(swallow('pty', 'resize'));
      }
    } catch { /* container not laid out yet */ }
  }, [fontScale]);

  // Refit when this tab becomes visible: hidden panes fit to a stale/zero size,
  // so a terminal opened while the dock was small renders cramped until shown.
  useEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame(() => {
      const term = termRef.current, fit = fitRef.current;
      if (!term || !fit || !activePtyIdRef.current) return;
      try {
        fit.fit();
        resizePty(activePtyIdRef.current, term.cols, term.rows).catch(swallow('pty', 'resize'));
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
