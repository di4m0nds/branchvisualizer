// apps/branchvisualizer/src/components/workspace/editor/EditorStatusBar.tsx
// Phase 8 — Dual-theme status bar (Neon Abyss / Ivory Studio).
// Uses CSS vars injected by HackerTheme so all colours react to theme switch.
//
// Layout:
//  ┌─────────────────────────────────────────────────────────────────────────┐
//  │ [●mod] src/components/App.tsx  │  Ln 42 Col 7 │ ✗3 ⚠1  │ TS  │ UTF-8 │
//  └─────────────────────────────────────────────────────────────────────────┘

import { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '@/store/AppContext';
import type { OpenFile } from '@/types';
import type { DiagnosticSummary } from './ErrorLens';

// ---------------------------------------------------------------------------
// Language short names
// ---------------------------------------------------------------------------

const LANG_SHORT: Record<string, string> = {
  typescript: 'TS', tsx: 'TSX', javascript: 'JS', jsx: 'JSX',
  python: 'PY', rust: 'RS', go: 'GO', java: 'JV', kotlin: 'KT',
  cpp: 'C++', c: 'C', csharp: 'C#', ruby: 'RB', php: 'PHP',
  swift: 'SW', html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'LESS',
  json: 'JSON', yaml: 'YAML', toml: 'TOML', markdown: 'MD',
  shell: 'SH', dockerfile: 'DOCK', sql: 'SQL', graphql: 'GQL',
  xml: 'XML', plaintext: 'TXT',
};

function langShort(id: string): string {
  return LANG_SHORT[id] ?? id.toUpperCase().slice(0, 5);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1_048_576).toFixed(1)}M`;
}

// ---------------------------------------------------------------------------
// Segment pill
// ---------------------------------------------------------------------------

function Seg({
  children, title, onClick, color,
}: {
  children: React.ReactNode;
  title?: string;
  onClick?: () => void;
  color?: string;   // inline override; default falls through to CSS var
}) {
  return (
    <div
      title={title}
      onClick={onClick}
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          '3px',
        padding:      '0 8px',
        height:       '100%',
        borderRight:  '1px solid var(--hk-bdr)',
        color:        color ?? 'var(--hk-fg-muted)',
        fontSize:     '10px',
        fontFamily:   '"JetBrains Mono", monospace',
        cursor:       onClick ? 'pointer' : 'default',
        whiteSpace:   'nowrap',
        flexShrink:   0,
        transition:   'background 120ms',
      }}
      onMouseEnter={onClick ? e => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--hk-bg-line)';
      } : undefined}
      onMouseLeave={onClick ? e => {
        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      } : undefined}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EditorStatusBarProps {
  openFile: OpenFile | null;
}

export default function EditorStatusBar({ openFile }: EditorStatusBarProps) {
  const { state } = useAppContext();
  const [diag, setDiag] = useState<DiagnosticSummary>({ errors: 0, warnings: 0, infos: 0 });

  const cursorLine   = state.openFile?.cursorLine   ?? 1;
  const cursorColumn = state.openFile?.cursorColumn ?? 1;
  const selStart     = state.openFile?.selectionStart;
  const selEnd       = state.openFile?.selectionEnd;
  const isDirty      = state.openFile?.isDirty ?? false;

  useEffect(() => {
    const handler = (e: CustomEvent<DiagnosticSummary>) => setDiag(e.detail);
    window.addEventListener('codeatlas:diagnostics', handler as EventListener);
    return () => window.removeEventListener('codeatlas:diagnostics', handler as EventListener);
  }, []);

  useEffect(() => {
    setDiag({ errors: 0, warnings: 0, infos: 0 });
  }, [openFile?.path]);

  const selectionInfo = useMemo(() => {
    if (!selStart || !selEnd) return null;
    if (selStart.line === selEnd.line && selStart.column === selEnd.column) return null;
    if (selStart.line === selEnd.line) return `${Math.abs(selEnd.column - selStart.column)} sel`;
    return `${Math.abs(selEnd.line - selStart.line) + 1}L sel`;
  }, [selStart, selEnd]);

  const fileSize = useMemo(() => {
    if (!openFile?.content) return null;
    return formatSize(new TextEncoder().encode(openFile.content).length);
  }, [openFile?.content]);

  const shortPath = useMemo(() => {
    if (!openFile?.path) return null;
    const parts = openFile.path.replace(/^\/+/, '').split('/');
    return parts.length > 4 ? '…/' + parts.slice(-4).join('/') : parts.join('/');
  }, [openFile?.path]);

  return (
    <div style={{
      display:    'flex',
      alignItems: 'stretch',
      height:     '22px',
      background: 'var(--hk-bg)',
      borderTop:  '1px solid var(--hk-bdr)',
      flexShrink: 0,
      overflow:   'hidden',
    }}>

      {/* ── Left ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflow: 'hidden' }}>

        {isDirty && (
          <Seg color="var(--hk-warn)" title="Unsaved changes">●</Seg>
        )}

        {shortPath && (
          <Seg
            color={isDirty ? 'var(--hk-warn)' : 'var(--hk-fn)'}
            title={openFile?.path}
          >
            {shortPath}
          </Seg>
        )}
      </div>

      {/* ── Right ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>

        {selectionInfo && (
          <Seg color="var(--hk-cls)" title="Selection">{selectionInfo}</Seg>
        )}

        {openFile && (
          <Seg color="var(--hk-fg)" title={`Ln ${cursorLine}, Col ${cursorColumn}`}>
            {cursorLine}:{cursorColumn}
          </Seg>
        )}

        {openFile && (
          <Seg
            title={diag.firstError ? `First error: ${diag.firstError}` : 'Diagnostics'}
            onClick={diag.errors + diag.warnings > 0
              ? () => window.__codeatlasEditor?.getAction('editor.action.marker.next')?.run().catch(() => {})
              : undefined}
            color={
              diag.errors   > 0 ? 'var(--hk-err)'  :
              diag.warnings > 0 ? 'var(--hk-warn)' :
              'var(--hk-fg-muted)'
            }
          >
            {diag.errors   > 0 && <span style={{ color: 'var(--hk-err)' }}>✗{diag.errors}</span>}
            {diag.warnings > 0 && (
              <span style={{
                color: 'var(--hk-warn)',
                marginLeft: diag.errors > 0 ? '5px' : '0',
              }}>⚠{diag.warnings}</span>
            )}
            {diag.errors === 0 && diag.warnings === 0 && (
              <span style={{ color: 'var(--hk-fg-muted)', opacity: 0.5 }}>✓</span>
            )}
          </Seg>
        )}

        {fileSize && <Seg title="File size">{fileSize}</Seg>}

        {openFile && (
          <Seg color="var(--hk-type)" title={`Language: ${openFile.language}`}>
            {langShort(openFile.language)}
          </Seg>
        )}

        <Seg title="Encoding">UTF-8</Seg>
        <Seg title="End of line">LF</Seg>
      </div>
    </div>
  );
}
