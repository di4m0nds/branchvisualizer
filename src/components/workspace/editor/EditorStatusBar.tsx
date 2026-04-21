// apps/branchvisualizer/src/components/workspace/editor/EditorStatusBar.tsx
// Phase 8 -- VS Code-style bottom status bar for the editor.
// Shows: language ID, cursor position (Ln Col), selection info,
// encoding (always UTF-8 for web), EOL type, file size.
// Driven entirely by AppState openFile + live cursor from UPDATE_CURSOR action.

import React, { useMemo } from 'react';
import { useAppContext } from '@/store/AppContext';
import type { OpenFile } from '@/types';

// ---------------------------------------------------------------------------
// Language display names (mapped from Monaco language IDs)
// ---------------------------------------------------------------------------

const LANGUAGE_DISPLAY: Record<string, string> = {
  typescript:   'TypeScript',
  javascript:   'JavaScript',
  json:         'JSON',
  html:         'HTML',
  css:          'CSS',
  scss:         'SCSS',
  less:         'Less',
  markdown:     'Markdown',
  python:       'Python',
  rust:         'Rust',
  go:           'Go',
  java:         'Java',
  cpp:          'C++',
  c:            'C',
  csharp:       'C#',
  ruby:         'Ruby',
  php:          'PHP',
  swift:        'Swift',
  kotlin:       'Kotlin',
  sql:          'SQL',
  graphql:      'GraphQL',
  yaml:         'YAML',
  toml:         'TOML',
  shell:        'Shell Script',
  dockerfile:   'Dockerfile',
  xml:          'XML',
  plaintext:    'Plain Text',
};

function displayLanguage(langId: string): string {
  return LANGUAGE_DISPLAY[langId] ?? langId;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// StatusPill -- single status segment
// ---------------------------------------------------------------------------

function StatusPill({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <span
      title={title}
      onClick={onClick}
      style={{
        padding: '0 6px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        fontSize: '11px',
        color: 'var(--text-muted, #6b7280)',
        borderRight: '1px solid var(--border-color, #2d2d35)',
        whiteSpace: 'nowrap',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        gap: '4px',
      }}
      onMouseEnter={onClick ? (e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover, #1a1a2e)'; }) : undefined}
      onMouseLeave={onClick ? (e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }) : undefined}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// EditorStatusBar props
// ---------------------------------------------------------------------------

interface EditorStatusBarProps {
  openFile: OpenFile | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EditorStatusBar({ openFile }: EditorStatusBarProps) {
  const { state } = useAppContext();

  const cursorLine   = state.openFile?.cursorLine   ?? 1;
  const cursorColumn = state.openFile?.cursorColumn ?? 1;
  const selStart = state.openFile?.selectionStart;
  const selEnd   = state.openFile?.selectionEnd;

  const selectionInfo = useMemo(() => {
    if (!selStart || !selEnd) return null;
    const samePos =
      selStart.line === selEnd.line && selStart.column === selEnd.column;
    if (samePos) return null;
    if (selStart.line === selEnd.line) {
      const chars = Math.abs(selEnd.column - selStart.column);
      return `${chars} selected`;
    }
    const lines = Math.abs(selEnd.line - selStart.line) + 1;
    return `${lines} lines selected`;
  }, [selStart, selEnd]);

  const fileSize = useMemo(() => {
    if (!openFile?.content) return null;
    return formatBytes(new TextEncoder().encode(openFile.content).length);
  }, [openFile?.content]);

  const langDisplay = openFile ? displayLanguage(openFile.language) : null;
  const isDirty = state.openFile?.isDirty ?? false;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      height: '22px',
      background: 'var(--bg-secondary, #0d0d0f)',
      borderTop: '1px solid var(--border-color, #2d2d35)',
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {/* Left side */}
      <div style={{ display: 'flex', alignItems: 'stretch', flex: 1 }}>
        {isDirty && (
          <StatusPill title="File has unsaved changes">
            <span style={{ color: '#d29922' }}>●</span>
            <span>Modified</span>
          </StatusPill>
        )}
        {openFile && (
          <StatusPill title={`File: ${openFile.path}`}>
            <span style={{ fontFamily: 'monospace', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {openFile.path.split('/').pop()}
            </span>
          </StatusPill>
        )}
      </div>

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'stretch', borderLeft: '1px solid var(--border-color, #2d2d35)' }}>
        {selectionInfo && (
          <StatusPill title="Current selection">
            {selectionInfo}
          </StatusPill>
        )}
        {openFile && (
          <StatusPill title={`Cursor position: Line ${cursorLine}, Column ${cursorColumn}`}>
            Ln {cursorLine}, Col {cursorColumn}
          </StatusPill>
        )}
        {fileSize && (
          <StatusPill title="File size">
            {fileSize}
          </StatusPill>
        )}
        <StatusPill title="File encoding">
          UTF-8
        </StatusPill>
        <StatusPill title="End of line sequence">
          LF
        </StatusPill>
        {langDisplay && (
          <StatusPill title={`Language: ${langDisplay} (Monaco ID: ${openFile?.language})`}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5 }}>
              <path d="M4.72.22a.75.75 0 0 1 1.06 0L7.5 1.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L8.56 3l1.72 1.72a.75.75 0 1 1-1.06 1.06L7.5 4.06 5.78 5.78a.75.75 0 0 1-1.06-1.06L6.44 3 4.72 1.28a.75.75 0 0 1 0-1.06z"/>
            </svg>
            {langDisplay}
          </StatusPill>
        )}
      </div>
    </div>
  );
}
