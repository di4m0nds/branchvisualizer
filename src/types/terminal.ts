// ─── Terminal model ──────────────────────────────────────────────────────────
// Roles map to the document's <terminal_context>: agent output, a free shell,
// long-running servers, and the Neovim editor PTY.

export type TerminalRole = 'agent' | 'shell' | 'server' | 'nvim';

export interface TerminalDef {
  id: string;
  role: TerminalRole;
  title: string;
  /** Working directory the PTY spawns in. */
  cwd: string;
  /** Command to run; undefined = the user's login shell. */
  cmd?: string;
  args?: string[];
}
