import { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalSquare, Server, FileCode, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/platform';
import Terminal from './Terminal';
import { nextId } from '@/types/session';
import type { TerminalDef, TerminalRole } from '@/types/terminal';
import { subscribeOpenInNvim } from '@/hooks/useOpenInNvim';

const ROLE_LABEL: Record<TerminalRole, string> = {
  agent: 'Agent',
  shell: 'Shell',
  server: 'Server',
  nvim: 'nvim',
};

const ROLE_DOT: Record<TerminalRole, string> = {
  nvim: 'bg-green-400',
  server: 'bg-blue-400',
  agent: 'bg-purple-400',
  shell: 'bg-muted-foreground/50',
};

// Terminals that should close when their process exits. Nvim closes on
// `:q`/`:wq`/`:q!`/`:wq!` — the PTY child exits with a status and we don't want
// to leave a dead tab. Shells keep the exit trailer visible.
const AUTO_CLOSE_ON_EXIT: Record<TerminalRole, boolean> = {
  nvim: true,
  agent: false,
  shell: false,
  server: false,
};

function makeTerminal(role: TerminalRole, cwd: string, opts?: { args?: string[] }): TerminalDef {
  const id = nextId('term');
  if (role === 'nvim') {
    return { id, role, title: 'nvim', cwd, cmd: 'nvim', args: opts?.args };
  }
  return { id, role, title: `${ROLE_LABEL[role]} ${id.split('_').pop()}`, cwd };
}

/**
 * Tabbed terminal dock. Terminals stay mounted when hidden so their PTYs (and
 * shell/nvim state) survive tab switches. Killing on close or unmount prevents
 * zombies. Autoclose fires for nvim so `:q` removes the tab cleanly. Subscribes
 * to the useOpenInNvim event bus so file/docs tab clicks either send `:e <path>`
 * to a running nvim or spawn one with the file already loaded.
 */
export default function TerminalDock({
  cwd,
  sessionId,
}: {
  cwd: string;
  sessionId: string;
}) {
  const [terminals, setTerminals] = useState<TerminalDef[]>(() => [makeTerminal('shell', cwd)]);
  const [activeId, setActiveId] = useState<string>(() => terminals[0]?.id ?? '');

  // Registered per-terminal writers so we can send ex-commands (`:e path\r`) to
  // an already-running nvim without a round-trip through Tauri events.
  const writersRef = useRef<Record<string, (data: string) => Promise<void>>>({});

  const add = useCallback((role: TerminalRole, opts?: { args?: string[] }): TerminalDef => {
    const t = makeTerminal(role, cwd, opts);
    setTerminals((prev) => [...prev, t]);
    setActiveId(t.id);
    return t;
  }, [cwd]);

  const close = useCallback((id: string) => {
    delete writersRef.current[id];
    setTerminals((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (id === activeId) setActiveId(next[next.length - 1]?.id ?? '');
      return next;
    });
  }, [activeId]);

  // Open-in-nvim bus: send `:e <path>` to the newest nvim, or spawn one.
  useEffect(() => {
    if (!isTauri()) return;
    return subscribeOpenInNvim(sessionId, async ({ path }) => {
      const existing = [...terminals].reverse().find((t) => t.role === 'nvim');
      if (existing) {
        setActiveId(existing.id);
        const writer = writersRef.current[existing.id];
        if (writer) {
          const escaped = path.replace(/ /g, '\\ ');
          await writer(`\x1b:e ${escaped}\r`).catch(() => {});
        }
      } else {
        add('nvim', { args: [path] });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, terminals.length]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Tab strip */}
      <div className="flex items-center gap-1 px-1.5 h-8 border-b border-border bg-muted/20 flex-shrink-0">
        <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto scrollbar-hide">
          {terminals.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className={cn(
                'group flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-md text-[11px] font-mono transition-colors flex-shrink-0 border',
                t.id === activeId
                  ? 'bg-background text-foreground border-border shadow-sm'
                  : 'text-muted-foreground hover:text-foreground border-transparent hover:bg-accent/30',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', ROLE_DOT[t.role])} />
              <span className="truncate max-w-32">{t.title}</span>
              <span
                onClick={(e) => { e.stopPropagation(); close(t.id); }}
                className="flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-destructive rounded-sm"
                title="Close terminal"
              >
                <X className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5 flex-shrink-0 pl-1 border-l border-border/60">
          <DockButton onClick={() => add('shell')} icon={<TerminalSquare className="w-3 h-3" />}>Shell</DockButton>
          <DockButton onClick={() => add('server')} icon={<Server className="w-3 h-3" />}>Server</DockButton>
          <DockButton onClick={() => add('nvim')} icon={<FileCode className="w-3 h-3" />}>nvim</DockButton>
        </div>
      </div>

      {/* Terminal panes — all mounted, visibility toggled */}
      <div className="relative flex-1 min-h-0">
        {terminals.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground/60">
            {isTauri() ? (
              <>
                <TerminalSquare className="w-5 h-5 opacity-50" />
                <span>No terminals open.</span>
                <button
                  onClick={() => add('shell')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-accent/40 text-[11px] font-mono"
                >
                  <Plus className="w-3 h-3" /> New shell
                </button>
              </>
            ) : 'Terminals require the desktop app.'}
          </div>
        )}
        {terminals.map((t) => (
          <div
            key={t.id}
            className={cn('absolute inset-0 p-1.5', t.id !== activeId && 'invisible pointer-events-none')}
          >
            <Terminal
              def={t}
              active={t.id === activeId}
              onExit={AUTO_CLOSE_ON_EXIT[t.role] ? () => setTimeout(() => close(t.id), 120) : undefined}
              registerWriter={(w) => { writersRef.current[t.id] = w; }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function DockButton({ onClick, icon, children }: { onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors font-mono"
    >
      {icon}
      {children}
    </button>
  );
}
