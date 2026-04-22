// apps/branchvisualizer/src/components/workspace/editor/DiffView.tsx
// Phase 8 -- Monaco DiffEditor wrapper.
// Shows side-by-side (or inline) diff between two content strings.
// Exposes toggle between split and inline modes.

import React, { useState, useCallback } from 'react';
import { DiffEditor } from '@monaco-editor/react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EDITOR_OPTIONS = {
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
  renderWhitespace: 'boundary' as const,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'off' as const,
  readOnly: true,
  renderSideBySide: true,
  enableSplitViewResizing: true,
  ignoreTrimWhitespace: false,
  originalEditable: false,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiffViewProps {
  original: string;
  modified: string;
  language?: string;
  /** File path shown in the toolbar (optional). */
  filePath?: string;
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

interface ToolbarProps {
  filePath?: string;
  inline: boolean;
  onToggleInline: () => void;
}

function DiffToolbar({ filePath, inline, onToggleInline }: ToolbarProps) {
  const btn: React.CSSProperties = {
    padding: '2px 8px',
    borderRadius: '3px',
    border: '1px solid var(--border-color, #2d2d35)',
    background: 'transparent',
    color: 'var(--text-secondary, #a0aec0)',
    fontSize: '11px',
    cursor: 'pointer',
    lineHeight: '1.4',
  };
  const btnActive: React.CSSProperties = {
    ...btn,
    background: 'var(--bg-active, #1e3a6e)',
    color: 'var(--text-primary, #e2e8f0)',
    borderColor: 'var(--accent, #3b82f6)',
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '4px 10px',
      borderBottom: '1px solid var(--border-color, #2d2d35)',
      background: 'var(--bg-secondary, #0d0d0f)',
      flexShrink: 0,
      fontSize: '12px',
    }}>
      {filePath && (
        <span style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--text-muted, #6b7280)',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {filePath}
        </span>
      )}
      <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
        <button
          style={!inline ? btnActive : btn}
          onClick={!inline ? undefined : onToggleInline}
          title="Side-by-side diff"
        >
          Split
        </button>
        <button
          style={inline ? btnActive : btn}
          onClick={inline ? undefined : onToggleInline}
          title="Inline diff"
        >
          Inline
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffView
// ---------------------------------------------------------------------------

export default function DiffView({ original, modified, language = 'plaintext', filePath }: DiffViewProps) {
  const [inline, setInline] = useState(false);
  const toggleInline = useCallback(() => setInline(v => !v), []);

  const options = {
    ...EDITOR_OPTIONS,
    renderSideBySide: !inline,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <DiffToolbar filePath={filePath} inline={inline} onToggleInline={toggleInline} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DiffEditor
          theme="codeatlas-dark"
          language={language}
          original={original}
          modified={modified}
          options={options}
          loading={
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', color: 'var(--text-muted, #6b7280)', fontSize: '13px',
            }}>
              Loading diff…
            </div>
          }
        />
      </div>
    </div>
  );
}