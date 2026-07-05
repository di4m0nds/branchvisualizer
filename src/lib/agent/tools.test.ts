import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PinnedRule } from '@/types/session';

vi.mock('../platform', () => ({ invoke: vi.fn() }));

import { invoke } from '../platform';
import { checkPinnedRules, describeTool, executeTool, toolCategory } from './tools';

const invokeMock = vi.mocked(invoke);
const CTX = { root: '/tmp/proj' };

beforeEach(() => {
  invokeMock.mockReset();
});

// ─── Categorization + description ────────────────────────────────────────────

describe('toolCategory', () => {
  it('classifies tools into file / command / git', () => {
    expect(toolCategory('run_command')).toBe('command');
    expect(toolCategory('git_status')).toBe('git');
    expect(toolCategory('read_file')).toBe('file');
    expect(toolCategory('grep')).toBe('file');
  });
});

describe('describeTool', () => {
  it('produces one-line human summaries', () => {
    expect(describeTool('read_file', { path: 'a.ts' })).toBe('Read a.ts');
    expect(describeTool('list_dir', {})).toBe('List .');
    expect(describeTool('run_command', { command: 'ls' })).toBe('Run: ls');
    expect(describeTool('unknown_tool', {})).toBe('unknown_tool');
  });
});

// ─── Pinned-rule enforcement ─────────────────────────────────────────────────

describe('checkPinnedRules', () => {
  const noCommit: PinnedRule = {
    id: 'r1',
    text: 'Do not commit or push anything.',
    block: { tools: ['run_command'], pattern: 'git\\s+(commit|push)' },
  };

  it('blocks a matching tool call and surfaces the rule text', () => {
    const res = checkPinnedRules('run_command', { command: 'git commit -m x' }, [noCommit]);
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe(noCommit.text);
  });

  it('does not block other tools or non-matching input', () => {
    expect(checkPinnedRules('write_file', { path: 'x' }, [noCommit]).blocked).toBe(false);
    expect(checkPinnedRules('run_command', { command: 'git status' }, [noCommit]).blocked).toBe(false);
  });

  it('ignores rules without a block matcher and invalid regexes', () => {
    const textOnly: PinnedRule = { id: 'r2', text: 'be nice' };
    const broken: PinnedRule = { id: 'r3', text: 'broken', block: { tools: ['run_command'], pattern: '(' } };
    expect(checkPinnedRules('run_command', { command: 'anything' }, [textOnly, broken]).blocked).toBe(false);
  });

  it('matches case-insensitively against the serialized input', () => {
    const res = checkPinnedRules('run_command', { command: 'GIT PUSH origin' }, [noCommit]);
    expect(res.blocked).toBe(true);
  });
});

// ─── Execution ───────────────────────────────────────────────────────────────

describe('executeTool', () => {
  it('edit_file rejects when old_str is absent', async () => {
    invokeMock.mockResolvedValueOnce('line one\nline two');
    await expect(
      executeTool('edit_file', { path: 'f.ts', old_str: 'missing', new_str: 'x' }, CTX),
    ).rejects.toThrow('old_str not found in f.ts');
    expect(invokeMock).toHaveBeenCalledTimes(1); // never wrote
  });

  it('edit_file rejects when old_str is ambiguous', async () => {
    invokeMock.mockResolvedValueOnce('dup\ndup');
    await expect(
      executeTool('edit_file', { path: 'f.ts', old_str: 'dup', new_str: 'x' }, CTX),
    ).rejects.toThrow('ambiguous in f.ts (2 matches)');
  });

  it('edit_file replaces exactly one occurrence and writes back', async () => {
    invokeMock.mockResolvedValueOnce('const a = 1;\nconst b = 2;');
    invokeMock.mockResolvedValueOnce(undefined);
    const out = await executeTool('edit_file', { path: 'f.ts', old_str: 'a = 1', new_str: 'a = 9' }, CTX);
    expect(out).toBe('Edited f.ts.');
    expect(invokeMock).toHaveBeenLastCalledWith('agent_write_file', {
      root: CTX.root,
      path: 'f.ts',
      content: 'const a = 9;\nconst b = 2;',
    });
  });

  it('run_command formats stdout, stderr, and the exit code', async () => {
    invokeMock.mockResolvedValueOnce({ stdout: 'ok', stderr: 'warn', code: 0 });
    const out = await executeTool('run_command', { command: 'make' }, CTX);
    expect(out).toBe('ok\n[stderr]\nwarn\n[exit 0]');
    expect(invokeMock).toHaveBeenCalledWith('agent_run_command', { root: CTX.root, command: 'make' });
  });

  it('run_command routes through the Podman sandbox when enabled', async () => {
    invokeMock.mockResolvedValueOnce('ca-sbx-abc123'); // sandbox_ensure
    invokeMock.mockResolvedValueOnce({ stdout: 'in-container', stderr: '', code: 0 }); // sandbox_exec
    const ctx = { ...CTX, sandbox: { enabled: true, network: false } };
    const out = await executeTool('run_command', { command: 'uname -a' }, ctx);
    expect(out).toBe('in-container\n[exit 0]');
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'sandbox_ensure', {
      bin: 'podman',
      root: CTX.root,
      network: false,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'sandbox_exec', {
      bin: 'podman',
      name: 'ca-sbx-abc123',
      root: CTX.root,
      command: 'uname -a',
    });
  });

  it('run_command stays on the host when the sandbox is disabled', async () => {
    invokeMock.mockResolvedValueOnce({ stdout: 'host', stderr: '', code: 0 });
    const ctx = { ...CTX, sandbox: { enabled: false, network: true } };
    await executeTool('run_command', { command: 'ls' }, ctx);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('agent_run_command', { root: CTX.root, command: 'ls' });
  });

  it('list_dir renders directories with a trailing slash', async () => {
    invokeMock.mockResolvedValueOnce([
      { name: 'src', isDir: true },
      { name: 'README.md', isDir: false },
    ]);
    const out = await executeTool('list_dir', {}, CTX);
    expect(out).toBe('src/\nREADME.md');
  });

  it('grep reports (no matches) on empty output', async () => {
    invokeMock.mockResolvedValueOnce('');
    const out = await executeTool('grep', { pattern: 'TODO' }, CTX);
    expect(out).toBe('(no matches)');
  });

  it('throws on unknown tool names', async () => {
    await expect(executeTool('nope', {}, CTX)).rejects.toThrow('Unknown tool: nope');
  });
});
