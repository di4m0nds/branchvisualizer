// apps/branchvisualizer/src/components/workspace/EditorTab.tsx
// Phase 8 -- Root editor tab component.
// Layout: FileTreePanel (resizable left) + editor/preview area (right).
//
// Vim mode: MonacoEditor.tsx handles all vim initialization (initVimMode is
// called inside handleMount where the editor is definitely ready).
// VimStatusBar.tsx listens for codeatlas:vim-enabled/disabled events and
// renders itself automatically -- EditorTab just toggles via window API.
//
// File tree: Currently shows FS_ROOT (API server working directory).
// GitHub project integration is planned for a future phase after repo
// cloning / sparse checkout is available server-side.

import React, { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import { useAppContext } from '@/store/AppContext';
import { useCapabilities } from '@/hooks/useCapabilities';
import { EditorToolbar, type ViewMode } from './editor/EditorToolbar';
import type { OpenFile } from '@/types';

// Lazy-loaded heavy components (Monaco only loaded when editor is active)
const MonacoEditor = React.lazy(() => import('./editor/MonacoEditor'));
const FileTreePanel = React.lazy(() => import('./editor/FileTreePanel'));
const DiffView = React.lazy(() => import('./editor/DiffView'));
const FilePreview = React.lazy(() => import('./editor/FilePreview'));
const VimStatusBar = React.lazy(() => import('./editor/VimStatusBar'));
const EditorStatusBar = React.lazy(() => import('./editor/EditorStatusBar'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TREE_MIN = 160;
const TREE_MAX = 400;
const TREE_DEFAULT = 240;

// ---------------------------------------------------------------------------
// LockedState
// ---------------------------------------------------------------------------

function LockedState({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
      <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor" className="opacity-40">
        <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 3.5a2 2 0 1 1 4 0V6H6V4.5z"/>
      </svg>
      <span className="text-sm">{reason}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
      <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor" className="opacity-30">
        <path d="M2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM5 4.75v6.5c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-6.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0-.75.75Z"/>
      </svg>
      <span className="text-sm">Select a file from the tree to open it</span>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
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
}

function EditorArea({ openFile, viewMode, vimEnabled }: EditorAreaProps) {
  const { dispatch } = useAppContext();

  if (!openFile) return <EmptyState />;

  const handleCursorChange = (line: number, column: number) => {
    dispatch({ type: 'UPDATE_CURSOR', payload: { line, column } });
  };

  const handleSelectionChange = (
    start: { line: number; column: number },
    end: { line: number; column: number }
  ) => {
    dispatch({ type: 'UPDATE_SELECTION', payload: { start, end } });
  };

  const handleContentChange = (isDirty: boolean) => {
    dispatch({ type: 'MARK_FILE_DIRTY', payload: isDirty });
  };

  if (viewMode === 'diff') {
    return (
      <Suspense fallback={<LoadingSpinner />}>
        <DiffView original={openFile.content} modified={openFile.content} language={openFile.language} />
      </Suspense>
    );
  }

  if (viewMode === 'preview') {
    return (
      <Suspense fallback={<LoadingSpinner />}>
        <FilePreview path={openFile.path} content={openFile.content} language={openFile.language} />
      </Suspense>
    );
  }

  if (viewMode === 'split') {
    return (
      <div className="flex h-full min-h-0">
        <div className="w-1/2 h-full min-h-0 overflow-hidden border-r border-border">
          <Suspense fallback={<LoadingSpinner />}>
            <MonacoEditor openFile={openFile} onCursorChange={handleCursorChange}
              onSelectionChange={handleSelectionChange} onContentChange={handleContentChange} />
          </Suspense>
        </div>
        <div className="w-1/2 h-full min-h-0 overflow-hidden">
          <Suspense fallback={<LoadingSpinner />}>
            <FilePreview path={openFile.path} content={openFile.content} language={openFile.language} />
          </Suspense>
        </div>
      </div>
    );
  }

  // Default: editor mode
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0">
        <Suspense fallback={<LoadingSpinner />}>
          <MonacoEditor openFile={openFile} onCursorChange={handleCursorChange}
            onSelectionChange={handleSelectionChange} onContentChange={handleContentChange} />
        </Suspense>
      </div>
      {/* VimStatusBar self-activates via event listener -- shown only when vim is on */}
      <Suspense fallback={null}>
        <VimStatusBar />
      </Suspense>
      {/* Editor status bar: language, cursor, encoding */}
      <Suspense fallback={null}>
        <EditorStatusBar openFile={openFile} />
      </Suspense>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditorTab -- main export
// ---------------------------------------------------------------------------

export default function EditorTab() {
  const { state, dispatch } = useAppContext();
  const { hasCapability } = useCapabilities();
  const [treePanelWidth, setTreePanelWidth] = useState(TREE_DEFAULT);
  const [viewMode, setViewMode] = useState<ViewMode>('editor');
  const [vimEnabled, setVimEnabled] = useState(false);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(TREE_DEFAULT);

  // Sync vimEnabled state with MonacoEditor events
  useEffect(() => {
    const onEnabled = () => setVimEnabled(true);
    const onDisabled = () => setVimEnabled(false);
    window.addEventListener('codeatlas:vim-enabled', onEnabled);
    window.addEventListener('codeatlas:vim-disabled', onDisabled);
    // Restore state after hot-reload
    if (window.__codeatlasVimMode?.isEnabled()) setVimEnabled(true);
    return () => {
      window.removeEventListener('codeatlas:vim-enabled', onEnabled);
      window.removeEventListener('codeatlas:vim-disabled', onDisabled);
    };
  }, []);

  if (!hasCapability('read:files')) {
    return <LockedState reason="Sign in to access the editor" />;
  }

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = treePanelWidth;

    const onMouseMove = (me: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = me.clientX - startX.current;
      setTreePanelWidth(Math.min(TREE_MAX, Math.max(TREE_MIN, startWidth.current + delta)));
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [treePanelWidth]);

  const handleVimToggle = useCallback(() => {
    const vim = window.__codeatlasVimMode;
    if (!vim) {
      // Editor not yet mounted (e.g. no file open) -- toggle will activate on next mount
      try {
        const key = 'ca_editor_vim_mode';
        const was = localStorage.getItem(key) === '1';
        was ? localStorage.removeItem(key) : localStorage.setItem(key, '1');
        setVimEnabled(!was);
      } catch { /* ignore */ }
      return;
    }
    if (vim.isEnabled()) {
      vim.disable();
    } else {
      vim.enable();
    }
  }, []);

  void dispatch;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* File tree panel */}
      <div
        style={{ width: treePanelWidth, flexShrink: 0 }}
        className="flex flex-col h-full min-h-0 border-r border-border overflow-hidden"
      >
        <Suspense fallback={<LoadingSpinner />}>
          <FileTreePanel />
        </Suspense>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="w-1 flex-shrink-0 cursor-col-resize bg-border/50 hover:bg-primary/40 active:bg-primary/60 transition-colors z-10"
        title="Drag to resize"
      />

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <EditorToolbar
          openFile={state.openFile}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          vimEnabled={vimEnabled}
          onVimToggle={handleVimToggle}
        />
        <div className="flex-1 min-h-0 overflow-hidden">
          <EditorArea openFile={state.openFile} viewMode={viewMode} vimEnabled={vimEnabled} />
        </div>
      </div>
    </div>
  );
}
