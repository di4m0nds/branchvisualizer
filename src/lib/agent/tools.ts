// ─── Agent tools ────────────────────────────────────────────────────────────
// Dedicated (not raw-bash) tools so the harness can gate, render, and audit each
// action. Execution is backed by path-jailed Rust commands (src-tauri/src/fs.rs,
// git.rs). Pinned-rule enforcement runs BEFORE any gating/execution and cannot
// be talked past by the model.

import { invoke } from '../platform';
import type { PinnedRule, Project } from '@/types/session';
import type { NeutralToolSchema } from './transport';

export type ToolCategory = 'file' | 'command' | 'git';

export interface ToolContext {
  /** Project root; every path is jailed to this in Rust. */
  root: string;
  /** Podman runtime sandbox (session setting). When enabled, `run_command`
   *  executes inside an isolated container with `root` bind-mounted at the
   *  same absolute path — file tools stay host-side, paths stay consistent. */
  sandbox?: { enabled: boolean; network: boolean };
  /** Owning project — enables the knowledge-base and diagram tools. Absent →
   *  those tools error (they're also filtered from the schema list). */
  project?: Project;
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
  {
    name: 'list_knowledge',
    description: 'List the project knowledge base: one line per note (slug, folder, pinned, title). Notes are persistent project context maintained by the user.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'read_knowledge',
    description: 'Read one knowledge-base note by slug or title.',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string', description: 'Note slug (from list_knowledge) or exact title' } },
      required: ['note'],
    },
  },
  {
    name: 'save_knowledge',
    description: 'Create or update a knowledge-base note (persistent project memory shared across sessions). Use for durable facts, decisions, or conventions worth remembering — not transient task state.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string', description: 'Markdown body (replaces the note body if the title already exists)' },
        folder: { type: 'string', description: 'Optional folder/category' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'list_diagrams',
    description: 'List the project\'s Excalidraw diagrams (architecture sketches, flows, UI concepts drawn by the user).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'read_diagram',
    description: 'Read one diagram as structural text: labeled nodes, arrows (relationships/data flow), frames, and annotations. Use diagrams as specs when the user references them.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Diagram name (from list_diagrams)' } },
      required: ['name'],
    },
  },
];

/** Tool names that require a `project` in the ToolContext. */
export const KNOWLEDGE_TOOLS = new Set([
  'list_knowledge', 'read_knowledge', 'save_knowledge', 'list_diagrams', 'read_diagram',
]);

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

function requireProject(ctx: ToolContext): Project {
  if (!ctx.project) throw new Error('Knowledge base unavailable: no project bound to this session.');
  return ctx.project;
}

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
    case 'list_knowledge': return 'List knowledge-base notes';
    case 'read_knowledge': return `Read note ${input.note}`;
    case 'save_knowledge': return `Save note "${input.title}"`;
    case 'list_diagrams': return 'List project diagrams';
    case 'read_diagram': return `Read diagram ${input.name}`;
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
      let res: CommandResult;
      if (ctx.sandbox?.enabled) {
        // sandbox_ensure is idempotent — cheap after the container exists.
        const name = await invoke<string>('sandbox_ensure', {
          bin: 'podman',
          root,
          network: ctx.sandbox.network,
        });
        res = await invoke<CommandResult>('sandbox_exec', {
          bin: 'podman',
          name,
          root,
          command: String(input.command),
        });
      } else {
        res = await invoke<CommandResult>('agent_run_command', { root, command: String(input.command) });
      }
      const parts = [];
      if (res.stdout) parts.push(res.stdout);
      if (res.stderr) parts.push(`[stderr]\n${res.stderr}`);
      parts.push(`[exit ${res.code ?? '?'}]`);
      return parts.join('\n');
    }

    case 'git_status':
      return JSON.stringify(await invoke('git_status', { repoPath: root }), null, 2);

    case 'list_knowledge': {
      const project = requireProject(ctx);
      const { kbIndexText } = await import('../kb/kbStore');
      return (await kbIndexText(project)) || '(knowledge base is empty)';
    }

    case 'read_knowledge': {
      const project = requireProject(ctx);
      const { findNote, loadKb, readNoteBody } = await import('../kb/kbStore');
      await loadKb(project);
      const note = findNote(project, String(input.note ?? ''));
      if (!note) throw new Error(`No note matching "${input.note}" — use list_knowledge for the index.`);
      const body = await readNoteBody(project, note.id);
      return `<note slug="${note.slug}" title="${note.title}">\n${body}\n</note>`;
    }

    case 'save_knowledge': {
      const project = requireProject(ctx);
      const { createNote, findNote, loadKb, saveNote } = await import('../kb/kbStore');
      await loadKb(project);
      const title = String(input.title ?? '').trim();
      if (!title) throw new Error('title is required');
      const content = String(input.content ?? '');
      const folder = input.folder ? String(input.folder) : undefined;
      const existing = findNote(project, title);
      if (existing) {
        await saveNote(project, existing.id, { body: content, ...(folder !== undefined ? { folder } : {}) });
        return `Updated note "${existing.title}" (@kb:${existing.slug}).`;
      }
      const meta = await createNote(project, { title, body: content, folder });
      return `Created note "${meta.title}" (@kb:${meta.slug}).`;
    }

    case 'list_diagrams': {
      const project = requireProject(ctx);
      const { diagramIndexText } = await import('../diagrams/diagramStore');
      return (await diagramIndexText(project)) || '(no diagrams)';
    }

    case 'read_diagram': {
      const project = requireProject(ctx);
      const { diagramText } = await import('../diagrams/diagramStore');
      const text = await diagramText(project, String(input.name ?? ''));
      if (!text) throw new Error(`No diagram matching "${input.name}" — use list_diagrams for the index.`);
      return text;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
