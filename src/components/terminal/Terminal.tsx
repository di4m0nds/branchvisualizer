import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { isTauri, type Unlisten } from '@/lib/platform';
import { spawnPty, writePty, resizePty, killPty, onPtyData, onPtyExit } from '@/lib/pty';
import { useAppContext } from '@/store/AppContext';
import type { TerminalDef } from '@/types/terminal';

const DARK_THEME = { background: '#0a0a0a', foreground: '#e4e4e7', cursor: '#e4e4e7' };
const LIGHT_THEME = { background: '#ffffff', foreground: '#18181b', cursor: '#18181b' };

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
  onExit,
  registerWriter,
}: {
  def: TerminalDef;
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

  useEffect(() => {
    if (!isTauri() || !containerRef.current) return;

    const term = new XTerm({
      fontFamily: 'ui-monospace, "Geist Mono", "SFMono-Regular", Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: themeRef.current === 'dark' ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);

  if (!isTauri()) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground/60 text-center px-4">
        Terminals require the desktop app. Run <code className="mx-1 font-mono">pnpm tauri dev</code>.
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
