import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectCommands, groupForScript } from './detectors';

// This repo's own manifests are natural fixtures.
const repoRoot = resolve(__dirname, '../../..');
const ownPackageJson = readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
const ownCargoToml = readFileSync(resolve(repoRoot, 'src-tauri/Cargo.toml'), 'utf8');

describe('detectCommands', () => {
  it('surfaces this repo\'s npm scripts with the pnpm runner', async () => {
    const files = new Set(['package.json', 'pnpm-lock.yaml']);
    const cmds = await detectCommands(files, async () => ownPackageJson);
    const dev = cmds.find((c) => c.id === 'npm:dev');
    expect(dev?.command).toBe('pnpm run dev');
    expect(dev?.group).toBe('dev');
    expect(cmds.find((c) => c.id === 'npm:build')?.group).toBe('build');
    expect(cmds.find((c) => c.id === 'npm:lint')?.group).toBe('quality');
    expect(cmds.find((c) => c.id === 'npm:typecheck')?.group).toBe('quality');
  });

  it('lockfile picks the runner', async () => {
    const pkg = JSON.stringify({ scripts: { dev: 'vite' } });
    const yarn = await detectCommands(new Set(['package.json', 'yarn.lock']), async () => pkg);
    expect(yarn[0].command).toBe('yarn dev');
    const npm = await detectCommands(new Set(['package.json']), async () => pkg);
    expect(npm[0].command).toBe('npm run dev');
  });

  it('detects cargo commands from Cargo.toml presence', async () => {
    const cmds = await detectCommands(new Set(['Cargo.toml']), async () => ownCargoToml);
    expect(cmds.map((c) => c.command)).toContain('cargo test');
    expect(cmds.find((c) => c.command === 'cargo clippy')?.group).toBe('quality');
  });

  it('parses Makefile targets, skipping pattern rules and .PHONY', async () => {
    const makefile = [
      '.PHONY: all test',
      'all: build',
      '\t@echo hi',
      'build:',
      '\tgcc -o app main.c',
      'test:',
      '\t./run-tests.sh',
      '%.o: %.c',
      '\tgcc -c $<',
      'VAR:=x',
    ].join('\n');
    const cmds = await detectCommands(new Set(['Makefile']), async () => makefile);
    const labels = cmds.map((c) => c.label);
    expect(labels).toContain('make all');
    expect(labels).toContain('make build');
    expect(labels).toContain('make test');
    expect(labels.some((l) => l.includes('%'))).toBe(false);
    expect(labels.some((l) => l.includes('.PHONY'))).toBe(false);
    expect(cmds.find((c) => c.label === 'make test')?.group).toBe('test');
  });

  it('compose aliases and pyproject tools', async () => {
    const compose = await detectCommands(new Set(['compose.yaml']), async () => '');
    expect(compose.some((c) => c.command === 'docker compose up -d')).toBe(true);

    const py = await detectCommands(
      new Set(['pyproject.toml', 'uv.lock']),
      async () => '[tool.pytest.ini_options]\n[tool.ruff]\n',
    );
    expect(py.find((c) => c.id === 'py:pytest')?.command).toBe('uv run pytest');
    expect(py.some((c) => c.id === 'py:ruff')).toBe(true);
  });

  it('matches *.csproj by extension and merges multiple ecosystems', async () => {
    const cmds = await detectCommands(
      new Set(['App.csproj', 'Dockerfile']),
      async () => '',
    );
    expect(cmds.some((c) => c.command === 'dotnet run')).toBe(true);
    expect(cmds.some((c) => c.group === 'docker')).toBe(true);
  });

  it('groupForScript heuristics', () => {
    expect(groupForScript('dev')).toBe('dev');
    expect(groupForScript('test:e2e')).toBe('test');
    expect(groupForScript('build:prod')).toBe('build');
    expect(groupForScript('eslint')).toBe('quality');
    expect(groupForScript('publish')).toBe('other');
  });
});
