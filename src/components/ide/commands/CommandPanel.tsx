import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Play, RotateCw, TerminalSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/platform';
import { cachedCommands, scanProjectCommands } from '@/lib/commands/detect';
import type { CommandGroup, DevCommand } from '@/lib/commands/detectors';
import { runInTerminal } from '@/hooks/useRunInTerminal';
import { toast } from '@/services/toast';
import FocusablePanel from '../FocusablePanel';

// ─── Smart developer command panel (left column, below ProjectsSidebar) ──────
// Auto-detects the project's toolchain from its manifests and lists one-click
// commands. Running one opens a NEW interactive tab in the terminal dock (via
// the run-in-terminal bus) so the user can Ctrl+C it and read a dev server's
// live output — the panel itself stays a pure, glanceable command list.

const GROUP_ORDER: CommandGroup[] = ['dev', 'build', 'test', 'quality', 'docker', 'other'];
const GROUP_LABEL: Record<CommandGroup, string> = {
  dev: 'Develop', build: 'Build', test: 'Test', quality: 'Quality', docker: 'Docker', other: 'Other',
};

export default function CommandPanel({ root, sessionId, collapsed, onToggleCollapsed }: {
  root: string;
  sessionId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [commands, setCommands] = useState<DevCommand[] | null>(() => cachedCommands(root));
  const [scanning, setScanning] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<CommandGroup>>(() => new Set(['dev', 'build', 'test']));

  const scan = async () => {
    if (!isTauri()) return;
    setScanning(true);
    try {
      setCommands(await scanProjectCommands(root));
    } catch (e) {
      toast.error('Command scan failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setScanning(false);
    }
  };

  // Initial scan when nothing cached.
  useEffect(() => {
    if (commands === null && isTauri()) void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  const start = (cmd: DevCommand) => {
    // Hand off to the session's terminal dock as a new interactive tab.
    const ok = runInTerminal(sessionId, { command: cmd.command, title: cmd.label });
    if (!ok) {
      toast.error('Open the terminal for this session first', {
        description: 'The command runs as a new terminal tab.',
      });
    }
  };

  const grouped = useMemo(() => {
    const by = new Map<CommandGroup, DevCommand[]>();
    for (const c of commands ?? []) by.set(c.group, [...(by.get(c.group) ?? []), c]);
    return GROUP_ORDER.filter((g) => by.has(g)).map((g) => [g, by.get(g)!] as const);
  }, [commands]);

  // Collapsed: just the reopen strip.
  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        className="flex items-center gap-1.5 px-2 py-1 border-t border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
        title="Expand the command panel"
      >
        <TerminalSquare className="w-3 h-3" />
        Commands
        <ChevronRight className="w-3 h-3 ml-auto -rotate-90" />
      </button>
    );
  }

  return (
    <FocusablePanel id="commands" className="flex flex-col min-h-0 flex-1 border-t border-border bg-background">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border/60 flex-shrink-0">
        <TerminalSquare className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Commands</span>
        <button
          onClick={() => void scan()}
          disabled={scanning}
          className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-50"
          title="Re-scan project manifests"
        >
          <RotateCw className={cn('w-3 h-3', scanning && 'animate-spin')} />
        </button>
        <button
          onClick={onToggleCollapsed}
          className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground"
          title="Collapse"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1">
        {!isTauri() ? (
          <p className="text-[10px] text-muted-foreground/60 p-2">Requires the desktop app.</p>
        ) : commands === null || scanning ? (
          <p className="text-[10px] text-muted-foreground/60 p-2">Scanning manifests…</p>
        ) : commands.length === 0 ? (
          <p className="text-[10px] text-muted-foreground/60 p-2">No known manifests found at the project root.</p>
        ) : (
          grouped.map(([group, cmds]) => (
            <div key={group}>
              <button
                onClick={() => setOpenGroups((s) => {
                  const next = new Set(s);
                  if (next.has(group)) next.delete(group); else next.add(group);
                  return next;
                })}
                className="w-full flex items-center gap-1 px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground"
              >
                {openGroups.has(group) ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                {GROUP_LABEL[group]} ({cmds.length})
              </button>
              {openGroups.has(group) && cmds.map((c) => (
                <div key={c.id} className="group flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-accent/30">
                  <button
                    onClick={() => start(c)}
                    className="p-0.5 text-muted-foreground group-hover:text-green-500"
                    title={`Run in a new terminal tab: ${c.command}`}
                  >
                    <Play className="w-3 h-3" />
                  </button>
                  <span className="text-[11px] font-mono text-foreground/85 truncate flex-1" title={c.source}>
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </FocusablePanel>
  );
}
