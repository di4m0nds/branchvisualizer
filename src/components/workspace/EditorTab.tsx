// apps/branchvisualizer/src/components/workspace/EditorTab.tsx
// Phase 8 -- Root editor tab: hacker layout with vim, LSP, error lens, nav log.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │  TOOLBAR:  ▸find  path ●  │ EDIT DIFF PREV SPL │ VIM AI LOG            │
// ├──────────┬─────────────────────────────────────┬──────────────────────  │
// │          │                                     │                        │
// │ FileTree │   Monaco Editor (+ Error Lens)       │  Navigation Log        │
// │          │                                     │  (collapsible)         │
// │          ├─────────────────────────────────────┤                        │
// │          │  VimStatusBar (when vim active)      │                        │
// │          │  EditorStatusBar                     │                        │
// └──────────┴─────────────────────────────────────┴────────────────────────┘
//
// Emacs-style global keybindings:
//   Ctrl+X Ctrl+F  → FileFinder
//   Ctrl+X Ctrl+S  → save event
//   Ctrl+X Ctrl+C  → close file

import React, {
  useState, useRef, useCallback, useEffect, Suspense,
} from 'react';
import { useAppContext } from '@/store/AppContext';
import { useCapabilities } from '@/hooks/useCapabilities';
import { EditorToolbar, type ViewMode } from './editor/EditorToolbar';
import FileFinder from './editor/FileFinder';
import { emitNavLog } from './editor/ErrorLens';
import { applyRootCssVars } from './editor/HackerTheme';
import type { OpenFile } from '@/types';

// Lazy-loaded heavy components
const MonacoEditor  = React.lazy(() => import('./editor/MonacoEditor'));
const FileTreePanel = React.lazy(() => import('./editor/FileTreePanel'));
const DiffView      = React.lazy(() => import('./editor/DiffView'));
const FilePreview   = React.lazy(() => import('./editor/FilePreview'));
const VimStatusBar  = React.lazy(() => import('./editor/VimStatusBar'));
const EditorStatusBar = React.lazy(() => import('./editor/EditorStatusBar'));
const NavigationLog = React.lazy(() => import('./editor/NavigationLog'));

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const TREE_MIN    = 160;
const TREE_MAX    = 400;
const TREE_DEFAULT = 240;
const LOG_MIN     = 160;
const LOG_DEFAULT = 220;
const LOG_MAX     = 360;

// ---------------------------------------------------------------------------
// Hacker CSS (inject once)
// ---------------------------------------------------------------------------

const HACKER_STYLE_ID = 'ca-hacker-global';

function ensureHackerStyles(): void {
  if (document.getElementById(HACKER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HACKER_STYLE_ID;
  // Static structural CSS only — colour values come from CSS vars set by applyRootCssVars()
  style.textContent = `
    .ca-editor-root * { box-sizing: border-box; }
    .ca-editor-root ::-webkit-scrollbar { width: 6px; height: 6px; }
    .ca-editor-root ::-webkit-scrollbar-track  { background: var(--hk-bg); }
    .ca-editor-root ::-webkit-scrollbar-thumb  { background: var(--hk-bdr); border-radius: 2px; }
    .ca-editor-root ::-webkit-scrollbar-thumb:hover { background: var(--hk-bdr-act); }
    /* Error Lens inline decorations */
    .ca-lens-error   { font-style: italic; opacity: 0.85; }
    .ca-lens-warning { font-style: italic; opacity: 0.85; }
    .ca-lens-info    { font-style: italic; opacity: 0.7; }
    .ca-lens-hint    { font-style: italic; opacity: 0.5; }
    /* Error Lens glyph icons in Monaco gutter */
    .ca-glyph-error::before   { content: '✗'; color: var(--hk-err);  font-size: 11px; }
    .ca-glyph-warning::before { content: '⚠'; color: var(--hk-warn); font-size: 11px; }
    /* AI annotation decorations */
    .ai-annotation--error   { background: color-mix(in srgb, var(--hk-err)  14%, transparent); }
    .ai-annotation--warning { background: color-mix(in srgb, var(--hk-warn) 14%, transparent); }
    .ai-annotation--info    { background: color-mix(in srgb, var(--hk-info) 10%, transparent); }
    .ai-glyph--error::before   { content: '⊘'; color: var(--hk-err);  font-size: 11px; }
    .ai-glyph--warning::before { content: '◈'; color: var(--hk-warn); font-size: 11px; }
    .ai-glyph--info::before    { content: '◉'; color: var(--hk-info); font-size: 11px; }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Locked / Empty states
// ---------------------------------------------------------------------------

function LockedState({ reason }: { reason: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: '8px',
      background: 'var(--hk-bg)', fontFamily: '"JetBrains Mono", monospace',
    }}>
      <span style={{ color: 'var(--hk-err)', fontSize: '20px' }}>⊘</span>
      <span style={{ color: 'var(--hk-fg-muted)', fontSize: '11px' }}>{reason}</span>
    </div>
  );
}

function EmptyState({ onFindFile }: { onFindFile: () => void }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: '16px',
      background: 'var(--hk-bg)', fontFamily: '"JetBrains Mono", monospace',
    }}>
      <pre style={{
        color: 'var(--hk-cursor)', opacity: 0.18,
        fontSize: '9px', lineHeight: '1.4', margin: 0, textAlign: 'center',
        userSelect: 'none',
      }}>
{`  ██████╗ ██████╗ ██████╗ ███████╗
 ██╔════╝██╔═══██╗██╔══██╗██╔════╝
 ██║     ██║   ██║██║  ██║█████╗
 ██║     ██║   ██║██║  ██║██╔══╝
 ╚██████╗╚██████╔╝██████╔╝███████╗
  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝`}
      </pre>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
        <button
          onClick={onFindFile}
          style={{
            background: 'none',
            border: '1px solid var(--hk-bdr-act)',
            color: 'var(--hk-cursor)',
            padding: '5px 16px',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '11px', cursor: 'pointer', letterSpacing: '0.1em',
            borderRadius: '2px',
            transition: 'background 120ms',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--hk-bg-sel)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'none';
          }}
        >
          ▸ M-x find-file
        </button>
        <span style={{ color: 'var(--hk-fg-muted)', fontSize: '10px', opacity: 0.6 }}>
          Ctrl+X Ctrl+F  ·  :e  ·  ␣ff
        </span>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', background: 'var(--hk-bg)',
      color: 'var(--hk-fg-muted)', opacity: 0.5,
      fontFamily: '"JetBrains Mono", monospace', fontSize: '10px',
    }}>
      ▸ loading…
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditorArea
// ---------------------------------------------------------------------------

interface EditorAreaProps {
  openFile: OpenFile | null;
  viewMode: ViewMode;
  vimEnabled: boolean;
  onFindFile: () => void;
}

function EditorArea({ openFile, viewMode, vimEnabled, onFindFile }: EditorAreaProps) {
  const { dispatch } = useAppContext();

  if (!openFile) return <EmptyState onFindFile={onFindFile} />;

  const onCursorChange = (line: number, column: number) =>
    dispatch({ type: 'UPDATE_CURSOR', payload: { line, column } });

  const onSelectionChange = (
    start: { line: number; column: number },
    end:   { line: number; column: number },
  ) => dispatch({ type: 'UPDATE_SELECTION', payload: { start, end } });

  const onContentChange = (isDirty: boolean) =>
    dispatch({ type: 'MARK_FILE_DIRTY', payload: isDirty });

  // ── Diff view ──────────────────────────────────────────────────────────
  if (viewMode === 'diff') {
    const current = window.__codeatlasEditor?.getModel()?.getValue() ?? openFile.content;
    return (
      <Suspense fallback={<Spinner />}>
        <DiffView
          original={openFile.content}
          modified={current}
          language={openFile.language}
          filePath={openFile.path}
        />
      </Suspense>
    );
  }

  // ── Preview ───────────────────────────────────────────────────────────
  if (viewMode === 'preview') {
    return (
      <Suspense fallback={<Spinner />}>
        <FilePreview path={openFile.path} content={openFile.content} language={openFile.language} />
      </Suspense>
    );
  }

  // ── Split ─────────────────────────────────────────────────────────────
  if (viewMode === 'split') {
    return (
      <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', borderRight: '1px solid var(--hk-bdr)' }}>
          <Suspense fallback={<Spinner />}>
            <MonacoEditor
              openFile={openFile}
              onCursorChange={onCursorChange}
              onSelectionChange={onSelectionChange}
              onContentChange={onContentChange}
            />
          </Suspense>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <Suspense fallback={<Spinner />}>
            <FilePreview path={openFile.path} content={openFile.content} language={openFile.language} />
          </Suspense>
        </div>
      </div>
    );
  }

  // ── Default: editor ───────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Suspense fallback={<Spinner />}>
          <MonacoEditor
            openFile={openFile}
            onCursorChange={onCursorChange}
            onSelectionChange={onSelectionChange}
            onContentChange={onContentChange}
          />
        </Suspense>
      </div>
      {/* Vim status (self-shows only when vim is active) */}
      <Suspense fallback={null}>
        <VimStatusBar />
      </Suspense>
      {/* Editor status bar */}
      <Suspense fallback={null}>
        <EditorStatusBar openFile={openFile} />
      </Suspense>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditorTab
// ---------------------------------------------------------------------------

export default function EditorTab() {
  const { state, dispatch } = useAppContext();
  const { hasCapability }   = useCapabilities();

  const [treePanelWidth, setTreePanelWidth]   = useState(TREE_DEFAULT);
  const [logPanelWidth,  setLogPanelWidth]    = useState(LOG_DEFAULT);
  const [viewMode,       setViewMode]         = useState<ViewMode>('editor');
  const [vimEnabled,     setVimEnabled]       = useState(false);
  const [logVisible,     setLogVisible]       = useState(false);
  const [fileFinderOpen, setFileFinderOpen]   = useState(false);

  const treeResizing = useRef(false);
  const logResizing  = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  // ── Inject structural CSS once + apply initial theme vars ─────────────
  useEffect(() => {
    ensureHackerStyles();
    applyRootCssVars((state.theme ?? 'dark') as 'dark' | 'light');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-apply CSS vars whenever app theme changes ───────────────────────
  useEffect(() => {
    applyRootCssVars((state.theme ?? 'dark') as 'dark' | 'light');
  }, [state.theme]);

  // ── Sync vim state from events ─────────────────────────────────────────
  useEffect(() => {
    const onEnabled  = () => setVimEnabled(true);
    const onDisabled = () => setVimEnabled(false);
    window.addEventListener('codeatlas:vim-enabled',  onEnabled);
    window.addEventListener('codeatlas:vim-disabled', onDisabled);
    if (window.__codeatlasVimMode?.isEnabled()) setVimEnabled(true);
    return () => {
      window.removeEventListener('codeatlas:vim-enabled',  onEnabled);
      window.removeEventListener('codeatlas:vim-disabled', onDisabled);
    };
  }, []);

  // ── Open file-finder via DOM event (from vim ex-commands) ─────────────
  useEffect(() => {
    const handler = (e: CustomEvent<{ query?: string }>) => {
      setFileFinderOpen(true);
    };
    window.addEventListener('codeatlas:open-file-finder', handler as EventListener);
    return () => window.removeEventListener('codeatlas:open-file-finder', handler as EventListener);
  }, []);

  // ── Global emacs-style keybindings ────────────────────────────────────
  useEffect(() => {
    let awaitingXChord = false;
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl+X chord prefix
      if (e.ctrlKey && e.key === 'x') { awaitingXChord = true; return; }
      if (awaitingXChord) {
        awaitingXChord = false;
        // Ctrl+X Ctrl+F → find file
        if (e.ctrlKey && e.key === 'f') { e.preventDefault(); setFileFinderOpen(true); return; }
        // Ctrl+X Ctrl+S → save
        if (e.ctrlKey && e.key === 's') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('codeatlas:vim-write'));
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // ── Vim toggle ─────────────────────────────────────────────────────────
  const handleVimToggle = useCallback(() => {
    const vim = window.__codeatlasVimMode;
    if (!vim) {
      try {
        const k = 'ca_editor_vim_mode';
        const was = localStorage.getItem(k) === '1';
        was ? localStorage.removeItem(k) : localStorage.setItem(k, '1');
        setVimEnabled(!was);
      } catch {}
      return;
    }
    vim.isEnabled() ? vim.disable() : vim.enable();
  }, []);

  // ── Ask AI about current file ─────────────────────────────────────────
  const handleAskAi = useCallback(() => {
    if (!state.openFile) return;
    dispatch({
      type: 'REQUEST_AI_CHAT',
      shas: [],
      mode: 'editor',
      editorPrompt: `Explain this file: ${state.openFile.path}`,
    });
    emitNavLog({ type: 'lsp', path: state.openFile.path, detail: 'ask-ai' });
  }, [state.openFile, dispatch]);

  // ── Tree panel resize ─────────────────────────────────────────────────
  const onTreeResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    treeResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = treePanelWidth;
    const onMove = (me: MouseEvent) => {
      if (!treeResizing.current) return;
      const delta = me.clientX - resizeStartX.current;
      setTreePanelWidth(Math.min(TREE_MAX, Math.max(TREE_MIN, resizeStartW.current + delta)));
    };
    const onUp = () => { treeResizing.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [treePanelWidth]);

  // ── Log panel resize ──────────────────────────────────────────────────
  const onLogResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    logResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = logPanelWidth;
    const onMove = (me: MouseEvent) => {
      if (!logResizing.current) return;
      const delta = resizeStartX.current - me.clientX; // drag left to expand
      setLogPanelWidth(Math.min(LOG_MAX, Math.max(LOG_MIN, resizeStartW.current + delta)));
    };
    const onUp = () => { logResizing.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [logPanelWidth]);

  void dispatch;

  if (!hasCapability('read:files')) {
    return <LockedState reason="read:files capability required" />;
  }

  return (
    <div
      className="ca-editor-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--hk-bg)',
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      }}
    >
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <EditorToolbar
        openFile={state.openFile}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        vimEnabled={vimEnabled}
        onVimToggle={handleVimToggle}
        onAskAi={handleAskAi}
        onFindFile={() => setFileFinderOpen(true)}
        logVisible={logVisible}
        onToggleLog={() => setLogVisible(v => !v)}
      />

      {/* ── Body: [FileTree] [Editor] [Log] ──────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* File tree panel */}
        <div style={{
          width: treePanelWidth,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          borderRight: '1px solid var(--hk-bdr)',
          overflow: 'hidden',
          background: 'var(--hk-bg)',
        }}>
          <Suspense fallback={<Spinner />}>
            <FileTreePanel />
          </Suspense>
        </div>

        {/* Tree resize handle */}
        <div
          onMouseDown={onTreeResizeStart}
          style={{
            width: '3px',
            flexShrink: 0,
            cursor: 'col-resize',
            background: 'transparent',
            zIndex: 10,
            transition: 'background 120ms',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--hk-bdr-act)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          title="Drag to resize tree"
        />

        {/* Editor area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          <EditorArea
            openFile={state.openFile}
            viewMode={viewMode}
            vimEnabled={vimEnabled}
            onFindFile={() => setFileFinderOpen(true)}
          />
        </div>

        {/* Log panel (collapsible) */}
        {logVisible && (
          <>
            {/* Log resize handle */}
            <div
              onMouseDown={onLogResizeStart}
              style={{
                width: '3px',
                flexShrink: 0,
                cursor: 'col-resize',
                background: 'transparent',
                zIndex: 10,
                transition: 'background 120ms',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--hk-bdr-act)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              title="Drag to resize log"
            />
            <div style={{
              width: logPanelWidth,
              flexShrink: 0,
              height: '100%',
              minHeight: 0,
              overflow: 'hidden',
            }}>
              <Suspense fallback={null}>
                <NavigationLog visible />
              </Suspense>
            </div>
          </>
        )}
      </div>

      {/* ── FileFinder modal ─────────────────────────────────────────────── */}
      <FileFinder
        open={fileFinderOpen}
        onClose={() => setFileFinderOpen(false)}
      />
    </div>
  );
}
