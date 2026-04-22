// apps/branchvisualizer/src/components/workspace/editor/diffParser.ts
// Phase 8 -- Unified diff parser.
// Parses "git diff --unified" / GitHub patch format into original+modified
// string pairs that Monaco DiffEditor can consume directly.
// No external dependency -- pure string parsing.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileDiff {
  /** Relative path (e.g. "src/App.tsx"). Taken from +++ b/... line. */
  path: string;
  /** Old filename (--- a/...).  May differ on renames. */
  oldPath: string;
  /** Full content of the original file (reconstructed from hunks). */
  original: string;
  /** Full content of the modified file (reconstructed from hunks). */
  modified: string;
  /** Monaco language id detected from extension. */
  language: string;
}

// ---------------------------------------------------------------------------
// Language detection (reuses same map as backend — kept in sync)
// ---------------------------------------------------------------------------

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  json: 'json', md: 'markdown', mdx: 'markdown',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sh: 'shell', bash: 'shell', py: 'python',
  rs: 'rust', go: 'go', java: 'java', cpp: 'cpp',
  c: 'c', h: 'c', cs: 'csharp', rb: 'ruby',
  php: 'php', swift: 'swift', kt: 'kotlin',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
};

function detectLanguage(filename: string): string {
  if (filename.toLowerCase() === 'dockerfile') return 'dockerfile';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_MAP[ext] ?? 'plaintext';
}

// ---------------------------------------------------------------------------
// Strip leading "a/" or "b/" prefix from git diff paths
// ---------------------------------------------------------------------------

function stripPrefix(p: string): string {
  if (p.startsWith('a/') || p.startsWith('b/')) return p.slice(2);
  if (p === '/dev/null') return '/dev/null';
  return p;
}

// ---------------------------------------------------------------------------
// parsePatch
// Parses a unified diff string (possibly multi-file) into an array of FileDiff.
// Handles:
//   - "diff --git a/... b/..." headers
//   - "--- a/..." / "+++ b/..." path lines
//   - "@@ -start,count +start,count @@" hunk headers
//   - Context lines (space), removals (-), additions (+)
//   - No-newline-at-end-of-file marker ("\ No newline at end of file")
// ---------------------------------------------------------------------------

export function parsePatch(patch: string): FileDiff[] {
  const results: FileDiff[] = [];
  const lines = patch.split('\n');

  let oldPath = '';
  let newPath = '';
  let originalLines: string[] = [];
  let modifiedLines: string[] = [];
  let inFile = false;

  const flush = () => {
    if (!inFile || (!oldPath && !newPath)) return;
    const path = newPath === '/dev/null' ? oldPath : newPath;
    results.push({
      path,
      oldPath,
      original: originalLines.join('\n'),
      modified: modifiedLines.join('\n'),
      language: detectLanguage(path),
    });
  };

  for (const line of lines) {
    // New file diff block
    if (line.startsWith('diff --git ')) {
      flush();
      oldPath = '';
      newPath = '';
      originalLines = [];
      modifiedLines = [];
      inFile = true;
      continue;
    }

    if (!inFile) continue;

    // Old path
    if (line.startsWith('--- ')) {
      oldPath = stripPrefix(line.slice(4).split('\t')[0]!.trim());
      continue;
    }

    // New path
    if (line.startsWith('+++ ')) {
      newPath = stripPrefix(line.slice(4).split('\t')[0]!.trim());
      continue;
    }

    // Hunk header — not needed for line reconstruction
    if (line.startsWith('@@ ')) continue;

    // No-newline marker — skip
    if (line.startsWith('\\ ')) continue;

    // Binary diff — mark as non-parseable
    if (line.startsWith('Binary files')) {
      originalLines = ['[binary file]'];
      modifiedLines = ['[binary file]'];
      continue;
    }

    // Context line (both original and modified)
    if (line.startsWith(' ') || line === '') {
      const content = line.startsWith(' ') ? line.slice(1) : '';
      originalLines.push(content);
      modifiedLines.push(content);
      continue;
    }

    // Removed line (original only)
    if (line.startsWith('-')) {
      originalLines.push(line.slice(1));
      continue;
    }

    // Added line (modified only)
    if (line.startsWith('+')) {
      modifiedLines.push(line.slice(1));
      continue;
    }
  }

  flush();
  return results;
}

// ---------------------------------------------------------------------------
// parseSingleFilePatch
// Convenience wrapper for GitHub API "patch" strings that contain a single
// file's hunks (no "diff --git" header, no "---"/"+++" lines).
// Caller must supply path + language.
// ---------------------------------------------------------------------------

export function parseSingleFilePatch(
  patch: string,
  path: string,
): Pick<FileDiff, 'original' | 'modified' | 'language'> {
  const lines = patch.split('\n');
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('@@ ')) continue;
    if (line.startsWith('\\ ')) continue;
    if (line.startsWith('-')) { originalLines.push(line.slice(1)); continue; }
    if (line.startsWith('+')) { modifiedLines.push(line.slice(1)); continue; }
    const content = line.startsWith(' ') ? line.slice(1) : line;
    originalLines.push(content);
    modifiedLines.push(content);
  }

  return {
    original: originalLines.join('\n'),
    modified: modifiedLines.join('\n'),
    language: detectLanguage(path),
  };
}
