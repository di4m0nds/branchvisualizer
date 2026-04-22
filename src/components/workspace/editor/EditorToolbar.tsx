// apps/branchvisualizer/src/components/workspace/editor/EditorToolbar.tsx
// Phase 8 — Editor toolbar. Dual-theme (dark: Neon Abyss / light: Ivory Studio).
//
// Uses CSS custom properties injected by HackerTheme.ts so all colours
// switch automatically when the app's theme toggles.

import React from 'react';
import type { OpenFile } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ViewMode = 'editor' | 'diff' | 'preview' | 'split';

export interface EditorToolbarProps {
  openFile:         OpenFile | null;
  viewMode:         ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  vimEnabled:       boolean;
  onVimToggle:      () => void;
  onAskAi?:         () => void;
  onFindFile?:      () => void;
  logVisible:       boolean;
  onToggleLog:      () => void;
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

function Btn({
  children, onClick, active, title, accentVar,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  accentVar?: string;          // CSS var name, e.g. '--hk-cursor'
}) {
  const accent = accentVar ? `var(${accentVar})` : 'var(--hk-cursor)';
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background:  active ? 'var(--hk-bg-sel)' : 'none',
        border:      active ? '1px solid var(--hk-bdr-act)' : '1px solid transparent',
        color:       active ? accent : 'var(--hk-fg-muted)',
        padding:     '0 8px',
        fontFamily:  '"JetBrains Mono", monospace',
        fontSize:    '10px',
        cursor:      'pointer',
        letterSpacing: '0.06em',
        height:      '20px',
        display:     'flex',
        alignItems:  'center',
        userSelect:  'none',
        flexShrink:  0,
        transition:  'color 120ms, background 120ms',
        borderRadius: '2px',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.color = accent;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.color = active ? accent : 'var(--hk-fg-muted)';
      }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return (
    <div style={{
      width: '1px', height: '14px',
      background: 'var(--hk-bdr)',
      margin: '0 4px',
      flexShrink: 0,
    }} />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EditorToolbar({
  openFile, viewMode, onViewModeChange,
  vimEnabled, onVimToggle, onAskAi, onFindFile,
  logVisible, onToggleLog,
}: EditorToolbarProps) {

  const shortPath = (() => {
    if (!openFile?.path) return null;
    const parts = openFile.path.replace(/^\/+/, '').split('/');
    return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : parts.join('/');
  })();

  return (
    <div style={{
      display:     'flex',
      alignItems:  'center',
      height:      '28px',
      background:  'var(--hk-bg)',
      borderBottom: '1px solid var(--hk-bdr)',
      flexShrink:  0,
      padding:     '0 6px',
      gap:         '2px',
      fontFamily:  '"JetBrains Mono", monospace',
      overflow:    'hidden',
    }}>

      {/* Find file — signature Emacs command */}
      <Btn onClick={onFindFile} title="M-x find-file  |  ␣ff  |  :e  |  Ctrl+X Ctrl+F">
        <span style={{ color: 'var(--hk-cursor)', marginRight: '3px' }}>▸</span>
        <span>find</span>
      </Btn>

      <Sep />

      {/* File path */}
      <div style={{
        flex: 1, overflow: 'hidden',
        display: 'flex', alignItems: 'center', gap: '5px',
        minWidth: 0,
      }}>
        {shortPath ? (
          <span style={{
            color: 'var(--hk-fg)',
            fontSize: '10px',
            opacity: 0.75,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {shortPath}
          </span>
        ) : (
          <span style={{ color: 'var(--hk-fg-muted)', fontSize: '10px' }}>no file</span>
        )}
        {openFile?.isDirty && (
          <span style={{ color: 'var(--hk-warn)', fontSize: '9px', flexShrink: 0 }}>●</span>
        )}
      </div>

      {/* View modes */}
      <Btn
        active={viewMode === 'editor'}
        onClick={() => onViewModeChange('editor')}
        title="Editor view"
        accentVar="--hk-fn"
      >EDIT</Btn>
      <Btn
        active={viewMode === 'diff'}
        onClick={() => onViewModeChange('diff')}
        title="Diff view"
        accentVar="--hk-warn"
      >DIFF</Btn>
      <Btn
        active={viewMode === 'preview'}
        onClick={() => onViewModeChange('preview')}
        title="Preview"
        accentVar="--hk-info"
      >PREV</Btn>
      <Btn
        active={viewMode === 'split'}
        onClick={() => onViewModeChange('split')}
        title="Split view"
        accentVar="--hk-type"
      >SPL</Btn>

      <Sep />

      {/* Vim mode */}
      <Btn
        active={vimEnabled}
        onClick={onVimToggle}
        title={vimEnabled ? 'Disable Vim mode' : 'Enable Vim mode (full keybindings)'}
        accentVar="--hk-kw"
      >VIM</Btn>

      {/* Ask AI */}
      {onAskAi && (
        <Btn onClick={onAskAi} title="Ask AI about current file" accentVar="--hk-dec">
          AI
        </Btn>
      )}

      <Sep />

      {/* Navigation log */}
      <Btn
        active={logVisible}
        onClick={onToggleLog}
        title="Toggle navigation log"
        accentVar="--hk-cls"
      >LOG</Btn>
    </div>
  );
}
