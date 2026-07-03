import { describe, expect, it } from 'vitest';
import {
  FILE_CAP_BYTES, FOLDER_ENTRY_CAP, TOTAL_CAP_BYTES,
  formatReferencedFiles, indexTree, parseRefTokens, resolveRefs, toMessageRefs,
} from './references';
import type { TreeEntry } from '@/hooks/useWorkspaceTree';

function entry(path: string, isDir = false, sizeBytes = 100): TreeEntry {
  return { path, name: path.slice(path.lastIndexOf('/') + 1), isDir, sizeBytes, depth: path.split('/').length - 1 };
}

const TREE: TreeEntry[] = [
  entry('src', true),
  entry('src/lib', true),
  entry('src/lib/fuzzy.ts'),
  entry('src/lib/utils.ts'),
  entry('docs', true),
  entry('docs/README.md', false, 500),
  entry('docker-compose.yml'),
  entry('assets', true),
  entry('assets/logo.png'),
  entry('pnpm-lock.yaml', false, 400_000),
];
const BY_PATH = indexTree(TREE);

describe('parseRefTokens', () => {
  it('matches exact tree paths after @ at word boundaries', () => {
    const refs = parseRefTokens('please read @src/lib/fuzzy.ts and @docs', BY_PATH);
    expect(refs).toEqual([
      { token: '@src/lib/fuzzy.ts', path: 'src/lib/fuzzy.ts', kind: 'file' },
      { token: '@docs', path: 'docs', kind: 'folder' },
    ]);
  });

  it('strips trailing punctuation from tokens', () => {
    const refs = parseRefTokens('look at @src/lib/utils.ts.', BY_PATH);
    expect(refs.map((r) => r.path)).toEqual(['src/lib/utils.ts']);
  });

  it('ignores emails, decorators, and non-tree paths', () => {
    const text = 'mail me@example.com about the @memo decorator in @not/a/real/path';
    expect(parseRefTokens(text, BY_PATH)).toEqual([]);
  });

  it('requires whitespace or start-of-text before @', () => {
    expect(parseRefTokens('foo@docs', BY_PATH)).toEqual([]);
    expect(parseRefTokens('@docs', BY_PATH).map((r) => r.path)).toEqual(['docs']);
  });

  it('dedupes repeated references', () => {
    const refs = parseRefTokens('@docs then @docs again', BY_PATH);
    expect(refs).toHaveLength(1);
  });
});

describe('resolveRefs', () => {
  const read = (contents: Record<string, string>) => async (path: string) => {
    if (!(path in contents)) throw new Error(`No such file (os error 2): ${path}`);
    return contents[path];
  };

  it('inlines file content and counts lines', async () => {
    const refs = await resolveRefs(
      '/root',
      parseRefTokens('@src/lib/fuzzy.ts', BY_PATH),
      TREE,
      read({ 'src/lib/fuzzy.ts': 'a\nb\nc' }),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ status: 'ok', body: 'a\nb\nc', lines: 3 });
  });

  it('truncates huge files at the per-file cap, keeping the head', async () => {
    const big = 'x'.repeat(FILE_CAP_BYTES + 1000);
    const refs = await resolveRefs(
      '/root',
      parseRefTokens('@src/lib/fuzzy.ts', BY_PATH),
      TREE,
      read({ 'src/lib/fuzzy.ts': big }),
    );
    expect(refs[0].status).toBe('truncated');
    expect(refs[0].body?.length).toBe(FILE_CAP_BYTES);
  });

  it('enforces the total budget across many refs', async () => {
    const half = 'y'.repeat(FILE_CAP_BYTES);
    const contents = {
      'src/lib/fuzzy.ts': half,
      'src/lib/utils.ts': half,
      'docker-compose.yml': half,
      'docs/README.md': half,
    };
    const refs = await resolveRefs(
      '/root',
      parseRefTokens('@src/lib/fuzzy.ts @src/lib/utils.ts @docker-compose.yml @docs/README.md', BY_PATH),
      TREE,
      read(contents),
    );
    const total = refs.reduce((n, r) => n + (r.body?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(TOTAL_CAP_BYTES);
  });

  it('marks binary files and lockfiles instead of reading them', async () => {
    const refs = await resolveRefs(
      '/root',
      parseRefTokens('@assets/logo.png and @pnpm-lock.yaml', BY_PATH),
      TREE,
      read({}),
    );
    expect(refs[0]).toMatchObject({ path: 'assets/logo.png', status: 'error' });
    expect(refs[1]).toMatchObject({ path: 'pnpm-lock.yaml', status: 'error' });
  });

  it('marks deleted files as not found', async () => {
    const refs = await resolveRefs(
      '/root',
      parseRefTokens('@src/lib/fuzzy.ts', BY_PATH),
      TREE,
      read({}),
    );
    expect(refs[0]).toMatchObject({ status: 'error', note: 'not found' });
  });

  it('renders folder listings and inlines a direct-child README', async () => {
    const refs = await resolveRefs(
      '/root',
      parseRefTokens('@docs', BY_PATH),
      TREE,
      read({ 'docs/README.md': '# Docs' }),
    );
    expect(refs[0]).toMatchObject({ kind: 'folder', status: 'ok' });
    expect(refs[0].body).toContain('README.md');
    expect(refs[1]).toMatchObject({ path: 'docs/README.md', body: '# Docs' });
  });

  it('caps folder listings at FOLDER_ENTRY_CAP entries', async () => {
    const bigTree: TreeEntry[] = [entry('big', true)];
    for (let i = 0; i < FOLDER_ENTRY_CAP + 50; i++) bigTree.push(entry(`big/f${i}.ts`));
    const refs = await resolveRefs(
      '/root',
      parseRefTokens('@big', indexTree(bigTree)),
      bigTree,
      read({}),
    );
    expect(refs[0].status).toBe('truncated');
    expect(refs[0].body).toContain('… and 50 more entries');
  });
});

describe('formatReferencedFiles', () => {
  it('emits the referenced_files block with file, folder, and error shapes', async () => {
    const tree = [...TREE];
    const refs = await resolveRefs(
      '/root',
      parseRefTokens('@src/lib/fuzzy.ts @docs @docker-compose.yml', BY_PATH),
      tree,
      async (path: string) => {
        if (path === 'src/lib/fuzzy.ts') return 'line1\nline2';
        if (path === 'docs/README.md') return '# Docs';
        throw new Error('No such file (os error 2)');
      },
    );
    const block = formatReferencedFiles(refs);
    expect(block).toContain('<referenced_files>');
    expect(block).toContain('<file path="src/lib/fuzzy.ts" lines="2">\nline1\nline2\n</file>');
    expect(block).toContain('<folder path="docs"');
    expect(block).toContain('<file path="docker-compose.yml" error=');
    expect(block).toContain('</referenced_files>');
  });

  it('returns empty string for no refs and strips bodies in toMessageRefs', () => {
    expect(formatReferencedFiles([])).toBe('');
    const stripped = toMessageRefs([
      { token: '@a', path: 'a', kind: 'file', status: 'ok', body: 'secret', lines: 1 },
    ]);
    expect(stripped[0]).not.toHaveProperty('body');
  });
});
