// apps/branchvisualizer/src/components/workspace/editor/MonacoEditor.tsx
// Phase 8 -- Monaco editor wrapper with AppContext bridge.
// IMPORTANT: never unmount Monaco during tab switches -- hide with CSS instead.

import { useRef, useEffect, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import type { OpenFile } from '@/types';
import { useAppContext } from '@/store/AppContext';

// ---------------------------------------------------------------------------
// Window augmentation (shared across editor sub-components)
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __codeatlasEditor?: MonacoType.editor.IStandaloneCodeEditor;
    __codeatlasAddAnnotation?: (
      line: number,
      message: string,
      severity: 'info' | 'warning' | 'error'
    ) => void;
    __codeatlassClearAnnotations?: () => void;
    __codeatlasVimMode?: {
      enable(): void;
      disable(): void;
      isEnabled(): boolean;
      statusBarNode: HTMLDivElement | null;
    };
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MonacoEditorProps {
  openFile: OpenFile;
  onCursorChange: (line: number, column: number) => void;
  onSelectionChange: (
    start: { line: number; column: number },
    end: { line: number; column: number }
  ) => void;
  onContentChange: (isDirty: boolean) => void;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Editor options (non-negotiable defaults per spec)
// ---------------------------------------------------------------------------

const EDITOR_OPTIONS: MonacoType.editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  lineHeight: 20,
  fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  fontLigatures: true,
  minimap: { enabled: true, scale: 1 },
  scrollBeyondLastLine: false,
  wordWrap: 'off',
  tabSize: 2,
  insertSpaces: true,
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  quickSuggestions: { other: true, comments: false, strings: false },
  inlineSuggest: { enabled: true },
  formatOnPaste: true,
  formatOnType: true,
  scrollbar: { vertical: 'visible', horizontal: 'visible', useShadows: false },
  overviewRulerLanes: 3,
  readOnly: false,
};

const VIM_LS_KEY = 'ca_editor_vim_mode';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MonacoEditor({
  openFile,
  onCursorChange,
  onSelectionChange,
  onContentChange,
  readOnly = false,
}: MonacoEditorProps) {
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const originalContentRef = useRef<string>(openFile.content);
  const decorationIdsRef = useRef<string[]>([]);
  const vimAdapterRef = useRef<{ dispose(): void } | null>(null);
  const statusBarNodeRef = useRef<HTMLDivElement | null>(null);

  // Reset original content ref when a new file is opened
  useEffect(() => {
    originalContentRef.current = openFile.content;
    if (editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        model.pushEditOperations([], [{
          range: model.getFullModelRange(),
          text: openFile.content,
        }], () => null);
        model.pushStackElement();
        originalContentRef.current = openFile.content;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile.path]);

  // ---------------------------------------------------------------------------
  // Vim mode helpers (defined before handleMount so they close over the refs)
  // ---------------------------------------------------------------------------

  const enableVim = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (vimAdapterRef.current) return; // already enabled

    // Create status bar node if needed
    if (!statusBarNodeRef.current) {
      const el = document.createElement('div');
      el.className = 'codeatlas-vim-statusbar';
      statusBarNodeRef.current = el;
    }

    try {
      const { initVimMode } = await import('monaco-vim') as {
        initVimMode: (
          editor: MonacoType.editor.IStandaloneCodeEditor,
          statusBarNode?: HTMLElement | null,
        ) => { dispose(): void }
      };
      vimAdapterRef.current = initVimMode(editor, statusBarNodeRef.current);
      try { localStorage.setItem(VIM_LS_KEY, '1'); } catch { /* ignore */ }

      // Notify EditorTab that vim is ready
      window.dispatchEvent(new CustomEvent('codeatlas:vim-enabled', {
        detail: { statusBarNode: statusBarNodeRef.current },
      }));
    } catch (err) {
      console.warn('[vim] init failed:', err);
    }
  }, []);

  const disableVim = useCallback(() => {
    vimAdapterRef.current?.dispose();
    vimAdapterRef.current = null;
    try { localStorage.removeItem(VIM_LS_KEY); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('codeatlas:vim-disabled'));
  }, []);

  const handleMount: OnMount = useCallback((editor, monacoInstance) => {
    editorRef.current = editor;

    // Expose editor instance for AI context and external tooling
    window.__codeatlasEditor = editor;

    // Expose Vim API so EditorTab / EditorToolbar can toggle without prop-drilling
    window.__codeatlasVimMode = {
      enable() { void enableVim(); },
      disable() { disableVim(); },
      isEnabled() { return !!vimAdapterRef.current; },
      statusBarNode: statusBarNodeRef.current,
    };

    // Configure TypeScript compiler options
    monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monacoInstance.languages.typescript.ScriptTarget.ESNext,
      moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monacoInstance.languages.typescript.ModuleKind.ESNext,
      jsx: monacoInstance.languages.typescript.JsxEmit.ReactJSX,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      strict: true,
    });

    // Cursor position change listener
    editor.onDidChangeCursorPosition((e) => {
      onCursorChange(e.position.lineNumber, e.position.column);
    });

    // Selection change listener
    editor.onDidChangeCursorSelection((e) => {
      const sel = e.selection;
      onSelectionChange(
        { line: sel.startLineNumber, column: sel.startColumn },
        { line: sel.endLineNumber, column: sel.endColumn }
      );
    });

    // Content change listener -- tracks dirty state
    editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model) return;
      const currentContent = model.getValue();
      const isDirty = currentContent !== originalContentRef.current;
      onContentChange(isDirty);
    });

    // Auto-enable vim if it was previously enabled
    const vimWasEnabled = (() => {
      try { return localStorage.getItem(VIM_LS_KEY) === '1'; } catch { return false; }
    })();
    if (vimWasEnabled) {
      void enableVim();
    }

    // Fire ready event so VimStatusBar / other consumers know editor is mounted
    window.dispatchEvent(new CustomEvent('codeatlas:editor-ready', { detail: { editor } }));
  }, [onCursorChange, onSelectionChange, onContentChange, enableVim, disableVim]);

  // Handle ADD_EDITOR_ANNOTATION dispatches via window globals
  const { state } = useAppContext();

  useEffect(() => {
    window.__codeatlasAddAnnotation = (
      lineNumber: number,
      message: string,
      severity: 'info' | 'warning' | 'error'
    ) => {
      const editor = editorRef.current;
      if (!editor) return;
      const monaco = (window as unknown as Record<string, unknown>)['monaco'] as typeof MonacoType | undefined;
      if (!monaco) return;
      const newIds = editor.deltaDecorations([], [{
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        options: {
          isWholeLine: true,
          className: `ai-annotation ai-annotation--${severity}`,
          glyphMarginClassName: `ai-glyph ai-glyph--${severity}`,
          hoverMessage: { value: `**AI:** ${message}` },
        },
      }]);
      decorationIdsRef.current = [...decorationIdsRef.current, ...newIds];
    };
    window.__codeatlassClearAnnotations = () => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.deltaDecorations(decorationIdsRef.current, []);
      decorationIdsRef.current = [];
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disableVim();
      delete window.__codeatlasEditor;
      delete window.__codeatlasVimMode;
    };
  }, [disableVim]);

  void state;

  return (
    <Editor
      height="100%"
      language={openFile.language}
      value={openFile.content}
      theme="codeatlas-dark"
      onMount={handleMount}
      options={{ ...EDITOR_OPTIONS, readOnly }}
    />
  );
}
