// ─── Agent tools ────────────────────────────────────────────────────────────
// Dedicated (not raw-bash) tools so the harness can gate, render, and audit each
// action. Execution is backed by path-jailed Rust commands (src-tauri/src/fs.rs,
// git.rs). Pinned-rule enforcement runs BEFORE any gating/execution and cannot
// be talked past by the model.

import { invoke } from '../platform';
import type { PinnedRule } from '@/types/session';
import type { NeutralToolSchema } from './transport';

export type ToolCategory = 'file' | 'command' | 'git';

export interface ToolContext {
  /** Project root; every path is jailed to this in Rust. */
  root: string;
}

export const TOOLS: NeutralToolSchema[] = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file within the project root.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to project root' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file within the project root.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace exactly one occurrence of old_str with new_str in a file. Errors if old_str is absent or ambiguous.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_str: { type: 'string' },
        new_str: { type: 'string' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  {
    name: 'list_dir',
    description: 'List a directory within the project root.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Defaults to "."' } },
      required: [],
    },
  },
  {
    name: 'grep',
    description: 'Search files for a regular expression within the project root.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: 'Optional subdirectory' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the project root and return captured stdout/stderr. Use for builds, tests, git status — NOT for interactive programs.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
  {
    name: 'git_status',
    description: 'Show the working-tree status (branch, staged, unstaged, untracked).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

export function toolCategory(name: string): ToolCategory {
  if (name === 'run_command') return 'command';
  if (name.startsWith('git_')) return 'git';
  return 'file';
}

// ─── Pinned-rule enforcement ─────────────────────────────────────────────────

export interface PinnedCheck {
  blocked: boolean;
  reason?: string;
}

/**
 * Returns blocked=true (with the rule text) if a pinned rule forbids this tool
 * call. Enforced at ALL access levels, before gating and execution.
 */
export function checkPinnedRules(
  toolName: string,
  input: unknown,
  rules: PinnedRule[],
): PinnedCheck {
  const haystack = typeof input === 'object' && input !== null
    ? JSON.stringify(input)
    : String(input ?? '');
  for (const rule of rules) {
    if (!rule.block) continue;
    if (!rule.block.tools.includes(toolName)) continue;
    let re: RegExp;
    try {
      re = new RegExp(rule.block.pattern, 'i');
    } catch {
      continue;
    }
    if (re.test(haystack) || re.test(toolName)) {
      return { blocked: true, reason: rule.text };
    }
  }
  return { blocked: false };
}

// ─── Execution ───────────────────────────────────────────────────────────────

interface CommandResult { stdout: string; stderr: string; code: number | null }
interface DirEntry { name: string; isDir: boolean }

/** A one-line human summary of a tool call, for the pending-action UI. */
export function describeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'read_file': return `Read ${input.path}`;
    case 'write_file': return `Write ${input.path}`;
    case 'edit_file': return `Edit ${input.path}`;
    case 'list_dir': return `List ${input.path ?? '.'}`;
    case 'grep': return `Grep /${input.pattern}/`;
    case 'run_command': return `Run: ${input.command}`;
    case 'git_status': return 'git status';
    default: return name;
  }
}

/** Execute an approved tool call. Returns the tool_result string. */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const root = ctx.root;
  switch (name) {
    case 'read_file':
      return invoke<string>('agent_read_file', { root, path: String(input.path) });

    case 'write_file':
      await invoke<void>('agent_write_file', { root, path: String(input.path), content: String(input.content) });
      return `Wrote ${input.path}.`;

    case 'edit_file': {
      const path = String(input.path);
      const oldStr = String(input.old_str);
      const newStr = String(input.new_str);
      const current = await invoke<string>('agent_read_file', { root, path });
      const count = current.split(oldStr).length - 1;
      if (count === 0) throw new Error(`old_str not found in ${path}`);
      if (count > 1) throw new Error(`old_str is ambiguous in ${path} (${count} matches)`);
      const updated = current.replace(oldStr, newStr);
      await invoke<void>('agent_write_file', { root, path, content: updated });
      return `Edited ${path}.`;
    }

    case 'list_dir': {
      const entries = await invoke<DirEntry[]>('agent_list_dir', { root, path: String(input.path ?? '.') });
      return entries.map((e) => (e.isDir ? `${e.name}/` : e.name)).join('\n') || '(empty)';
    }

    case 'grep': {
      const out = await invoke<string>('agent_grep', {
        root,
        pattern: String(input.pattern),
        path: input.path ? String(input.path) : null,
      });
      return out || '(no matches)';
    }

    case 'run_command': {
      const res = await invoke<CommandResult>('agent_run_command', { root, command: String(input.command) });
      const parts = [];
      if (res.stdout) parts.push(res.stdout);
      if (res.stderr) parts.push(`[stderr]\n${res.stderr}`);
      parts.push(`[exit ${res.code ?? '?'}]`);
      return parts.join('\n');
    }

    case 'git_status':
      return JSON.stringify(await invoke('git_status', { repoPath: root }), null, 2);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
