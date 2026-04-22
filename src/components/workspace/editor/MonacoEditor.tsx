// apps/branchvisualizer/src/components/workspace/editor/MonacoEditor.tsx
// Phase 8 -- Monaco editor: full vim, LSP navigation, Error Lens, hacker theme.
//
// Vim mode features (via monaco-vim):
//   Normal/Insert/Visual/Replace modes
//   Relative line numbers while vim is active
//   jk / kj → <Esc>   (insert escape)
//   Ctrl+[ → <Esc>     (terminal style)
//   gd  → go to definition   (Monaco LSP)
//   gD  → go to declaration
//   gr  → find references
//   gi  → go to implementation
//   K   → show hover info
//   ]e  → next error       (diagnostic jump)
//   [e  → prev error
//   ]w  → next warning
//   [w  → prev warning
//   <leader>rn  → rename symbol
//   <leader>ca  → code actions
//   <leader>ff  → open file finder (FileFinder)
//   <leader>fb  → format buffer
//   :e  / :find → open file finder
//   :w  → dispatch save event (Phase 10)
//   :noh → clear search highlight
//   clipboard = "unnamedplus"  → OS clipboard via + register
//   Ctrl+O / Ctrl+I → Monaco back / forward (jump list approximation)
//
// Language services:
//   TypeScript / JavaScript: built-in Monaco TS language service
//   All others: Monaco's basic per-language services (syntax highlight + basic)
//   Compilation errors displayed via Error Lens inline decorations.

import { useRef, useEffect, useCallback, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import type { OpenFile } from '@/types';
import { useAppContext } from '@/store/AppContext';
import {
  registerThemes,
  setEditorTheme,
  DARK_THEME_ID,
  LIGHT_THEME_ID,
  applyRootCssVars,
} from './HackerTheme';
import ErrorLens, { emitNavLog } from './ErrorLens';
import { openFileFinder } from './FileFinder';

// ---------------------------------------------------------------------------
// Window globals
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __codeatlasEditor?:           MonacoType.editor.IStandaloneCodeEditor;
    __codeatlasMonaco?:           typeof MonacoType;
    __codeatlasAddAnnotation?:    (line: number, msg: string, sev: 'info'|'warning'|'error') => void;
    __codeatlasClearAnnotations?: () => void;
    __codeatlasVimMode?: {
      enable(): void;
      disable(): void;
      isEnabled(): boolean;
      statusBarNode: HTMLDivElement | null;
    };
    __codeatlasJumpList?: { back(): void; forward(): void };
  }
}

// ---------------------------------------------------------------------------
// Lean defaults — performance-first
// ---------------------------------------------------------------------------

const EDITOR_OPTIONS: MonacoType.editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  lineHeight: 20,
  fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  fontLigatures: true,
  minimap: { enabled: true, scale: 1, renderCharacters: false },
  scrollBeyondLastLine: false,
  wordWrap: 'off',
  tabSize: 2,
  insertSpaces: true,
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  quickSuggestions: { other: true, comments: false, strings: false },
  suggestOnTriggerCharacters: true,
  inlineSuggest: { enabled: true },
  formatOnPaste: true,
  formatOnType: false,
  scrollbar: {
    vertical: 'visible', horizontal: 'visible',
    useShadows: false,
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
  overviewRulerLanes: 3,
  glyphMargin: true,        // needed for Error Lens glyph icons
  folding: true,
  foldingHighlight: true,
  showFoldingControls: 'mouseover',
  renderLineHighlight: 'all',
  cursorBlinking: 'phase',  // neon phosphor blink
  cursorSmoothCaretAnimation: 'on',
  smoothScrolling: true,
  mouseWheelZoom: true,
  padding: { top: 8, bottom: 8 },
  readOnly: false,
};

const VIM_LS_KEY  = 'ca_editor_vim_mode';
const LEADER      = ' ';  // Space as leader (set via Vim.map)

// ---------------------------------------------------------------------------
// LSP action helper — run Monaco editor action silently
// ---------------------------------------------------------------------------

function runAction(
  editor: MonacoType.editor.IStandaloneCodeEditor,
  actionId: string,
): void {
  try { editor.getAction(actionId)?.run().catch(() => {}); }
  catch { /* ignore if action unavailable */ }
}

// ---------------------------------------------------------------------------
// Per-language TypeScript compiler options
// ---------------------------------------------------------------------------

function configureLanguageServices(monaco: typeof MonacoType): void {
  // TypeScript / TSX
  const tsDefaults = monaco.languages.typescript.typescriptDefaults;
  tsDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    strict: true,
    noImplicitAny: true,
    skipLibCheck: true,
    lib: ['ESNext', 'DOM', 'DOM.Iterable'],
    baseUrl: '.',
    paths: { '@/*': ['./src/*'] },
  });
  tsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
    onlyVisible: false,
  });

  // JavaScript
  const jsDefaults = monaco.languages.typescript.javascriptDefaults;
  jsDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    allowJs: true,
    checkJs: true,
  });
  jsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  // JSON — enable schema validation
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: [],
    enableSchemaRequest: true,
  });

  // CSS / SCSS / Less
  monaco.languages.css.cssDefaults.setOptions({ validate: true, lint: { compatibleVendorPrefixes: 'ignore' } });
  monaco.languages.css.scssDefaults.setOptions({ validate: true });
  monaco.languages.css.lessDefaults.setOptions({ validate: true });
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

interface MonacoEditorProps {
  openFile: OpenFile;
  onCursorChange: (line: number, column: number) => void;
  onSelectionChange: (
    start: { line: number; column: number },
    end: { line: number; column: number },
  ) => void;
  onContentChange: (isDirty: boolean) => void;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// MonacoEditor
// ---------------------------------------------------------------------------

export default function MonacoEditor({
  openFile,
  onCursorChange,
  onSelectionChange,
  onContentChange,
  readOnly = false,
}: MonacoEditorProps) {
  const editorRef          = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef          = useRef<typeof MonacoType | null>(null);
  const originalContentRef = useRef<string>(openFile.content);
  const decorationIdsRef   = useRef<string[]>([]);
  const vimAdapterRef      = useRef<{ dispose(): void } | null>(null);
  const statusBarNodeRef   = useRef<HTMLDivElement | null>(null);
  const relNumDisposable   = useRef<{ dispose(): void } | null>(null);
  const copyListenerRef    = useRef<{ node: HTMLElement; fn: EventListener } | null>(null);

  // For ErrorLens (passed down to it)
  const [editorReady, setEditorReady] = useState(false);
  const { state } = useAppContext();

  // ── File switch: update model content ─────────────────────────────────────
  useEffect(() => {
    originalContentRef.current = openFile.content;
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model) {
      model.pushEditOperations(
        [], [{ range: model.getFullModelRange(), text: openFile.content }], () => null,
      );
      model.pushStackElement();
    }
    emitNavLog({ type: 'open', path: openFile.path, detail: openFile.language });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFile.path]);

  // =========================================================================
  // Vim mode
  // =========================================================================

  const enableVim = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || vimAdapterRef.current) return;

    if (!statusBarNodeRef.current) {
      const el = document.createElement('div');
      el.className = 'ca-vim-statusbar-node';
      statusBarNodeRef.current = el;
    }

    try {
      const monacoVim = await import('monaco-vim') as unknown as {
        initVimMode: (
          editor: MonacoType.editor.IStandaloneCodeEditor,
          statusBarNode?: HTMLElement | null,
        ) => { dispose(): void };
        VimMode?: {
          Vim?: {
            defineOption(name: string, value: unknown, type?: string): void;
            map(lhs: string, rhs: string, mode?: string): void;
            noremap(lhs: string, rhs: string, mode?: string): void;
            unmap(lhs: string, mode?: string): void;
            defineEx(name: string, prefix: string, fn: (...a: unknown[]) => void): void;
          };
        };
      };

      const Vim = monacoVim.VimMode?.Vim;
      if (Vim) {

        // ── Vim options ───────────────────────────────────────────────────
        const defOpt = (n: string, v: unknown, t?: string) => {
          try { Vim.defineOption(n, v, t); } catch { /* already defined */ }
        };
        defOpt('ignorecase', true, 'boolean');
        defOpt('smartcase',  true, 'boolean');
        defOpt('hlsearch',   true, 'boolean');
        defOpt('incsearch',  true, 'boolean');
        defOpt('clipboard',  'unnamedplus', 'string');
        defOpt('scrolloff',  5, 'number');
        defOpt('sidescrolloff', 5, 'number');

        // ── Insert mode escapes ───────────────────────────────────────────
        const imap = (lhs: string, rhs: string) => { try { Vim.map(lhs, rhs, 'insert'); } catch {} };
        imap('jk', '<Esc>');
        imap('kj', '<Esc>');
        imap('<C-[>', '<Esc>');
        imap('<C-c>', '<Esc>');

        // ── Normal mode LSP navigation ────────────────────────────────────
        const nmap = (lhs: string, rhs: string) => { try { Vim.map(lhs, rhs, 'normal'); } catch {} };
        // These map to vim ex commands that we intercept in defineEx
        nmap('gd', ':lsp-def<CR>');
        nmap('gD', ':lsp-decl<CR>');
        nmap('gr', ':lsp-ref<CR>');
        nmap('gi', ':lsp-impl<CR>');
        nmap('K',  ':lsp-hover<CR>');
        nmap(']e', ':lsp-next-err<CR>');
        nmap('[e', ':lsp-prev-err<CR>');
        nmap(']w', ':lsp-next-warn<CR>');
        nmap('[w', ':lsp-prev-warn<CR>');
        nmap(LEADER + 'rn', ':lsp-rename<CR>');
        nmap(LEADER + 'ca', ':lsp-action<CR>');
        nmap(LEADER + 'ff', ':Files<CR>');
        nmap(LEADER + 'fb', ':lsp-format<CR>');
        nmap(LEADER + 'e',  ':lsp-errors<CR>');
        // jump list approximation (Monaco history)
        nmap('<C-o>', ':go-back<CR>');
        nmap('<C-i>', ':go-forward<CR>');
        // Tab switching
        nmap('<C-PageUp>',   ':bn<CR>');
        nmap('<C-PageDown>', ':bp<CR>');

        // ── Visual mode clipboard ─────────────────────────────────────────
        // y in visual copies to OS clipboard (handled by DOM copy listener)
        // p in normal pastes from OS clipboard
        const vmap = (lhs: string, rhs: string) => { try { Vim.map(lhs, rhs, 'visual'); } catch {} };
        vmap('<C-c>', 'y');  // Ctrl+C copies in visual

        // ── Ex commands ───────────────────────────────────────────────────
        const ex = (name: string, prefix: string, fn: () => void) => {
          try { Vim.defineEx(name, prefix, fn); } catch {}
        };

        // File operations
        ex('write', 'w', () => {
          window.dispatchEvent(new CustomEvent('codeatlas:vim-write'));
          emitNavLog({ type: 'save', path: editorRef.current?.getModel()?.uri.path ?? '' });
        });
        ex('quit', 'q', () => {
          window.dispatchEvent(new CustomEvent('codeatlas:close-file'));
        });
        ex('edit', 'e', () => { openFileFinder(); });
        ex('Files', 'Files', () => { openFileFinder(); });
        ex('find', 'find', () => { openFileFinder(); });
        ex('buffers', 'ls', () => {
          window.dispatchEvent(new CustomEvent('codeatlas:open-file-finder'));
        });

        // LSP actions (invoked from nmap above)
        ex('lsp-def',       'lsp-def',       () => { runAction(editorRef.current!, 'editor.action.revealDefinition'); emitNavLog({ type: 'lsp', path: '', detail: 'go-to-def' }); });
        ex('lsp-decl',      'lsp-decl',      () => { runAction(editorRef.current!, 'editor.action.revealDeclaration'); });
        ex('lsp-ref',       'lsp-ref',       () => { runAction(editorRef.current!, 'editor.action.goToReferences'); emitNavLog({ type: 'lsp', path: '', detail: 'references' }); });
        ex('lsp-impl',      'lsp-impl',      () => { runAction(editorRef.current!, 'editor.action.goToImplementation'); });
        ex('lsp-hover',     'lsp-hover',     () => { runAction(editorRef.current!, 'editor.action.showHover'); });
        ex('lsp-rename',    'lsp-rename',    () => { runAction(editorRef.current!, 'editor.action.rename'); emitNavLog({ type: 'lsp', path: '', detail: 'rename' }); });
        ex('lsp-action',    'lsp-action',    () => { runAction(editorRef.current!, 'editor.action.quickFix'); });
        ex('lsp-format',    'lsp-format',    () => { runAction(editorRef.current!, 'editor.action.formatDocument'); emitNavLog({ type: 'lsp', path: '', detail: 'format' }); });
        ex('lsp-errors',    'lsp-errors',    () => { runAction(editorRef.current!, 'editor.action.marker.nextInFiles'); });
        ex('lsp-next-err',  'lsp-next-err',  () => { runAction(editorRef.current!, 'editor.action.marker.next'); });
        ex('lsp-prev-err',  'lsp-prev-err',  () => { runAction(editorRef.current!, 'editor.action.marker.prev'); });
        ex('lsp-next-warn', 'lsp-next-warn', () => { runAction(editorRef.current!, 'editor.action.marker.next'); });
        ex('lsp-prev-warn', 'lsp-prev-warn', () => { runAction(editorRef.current!, 'editor.action.marker.prev'); });

        // Navigation history
        ex('go-back',    'go-back',    () => { runAction(editorRef.current!, 'workbench.action.navigateBack'); });
        ex('go-forward', 'go-forward', () => { runAction(editorRef.current!, 'workbench.action.navigateForward'); });

        // Utilities
        ex('noh', 'noh', () => {
          runAction(editorRef.current!, 'editor.action.setSelectionAnchor');
          editorRef.current?.trigger('keyboard', 'removeSecondaryCursors', null);
        });
        ex('sort', 'sort', () => { runAction(editorRef.current!, 'editor.action.sortLinesAscending'); });
        ex('sortd', 'sortd', () => { runAction(editorRef.current!, 'editor.action.sortLinesDescending'); });
        ex('fold', 'fold', () => { runAction(editorRef.current!, 'editor.fold'); });
        ex('unfold', 'unfold', () => { runAction(editorRef.current!, 'editor.unfold'); });
        ex('foldall', 'foldall', () => { runAction(editorRef.current!, 'editor.foldAll'); });
        ex('unfoldall', 'unfoldall', () => { runAction(editorRef.current!, 'editor.unfoldAll'); });
      }

      // ── Init vim adapter ──────────────────────────────────────────────
      vimAdapterRef.current = monacoVim.initVimMode(editor, statusBarNodeRef.current);

      // ── Relative line numbers ─────────────────────────────────────────
      const applyRelNum = () => {
        const cur = editor.getPosition()?.lineNumber ?? 1;
        editor.updateOptions({
          lineNumbers: (n: number) =>
            n === cur ? String(n) : String(Math.abs(n - cur)),
        });
      };
      applyRelNum();
      relNumDisposable.current = editor.onDidChangeCursorPosition(applyRelNum);

      // ── OS clipboard sync (DOM copy event) ───────────────────────────
      const domNode = editor.getDomNode();
      if (domNode) {
        const handleCopy: EventListener = () => {
          const sel   = editor.getSelection();
          const model = editor.getModel();
          if (sel && model) {
            const text = model.getValueInRange(sel);
            if (text) navigator.clipboard.writeText(text).catch(() => {});
          }
        };
        domNode.addEventListener('copy', handleCopy);
        copyListenerRef.current = { node: domNode as HTMLElement, fn: handleCopy };
      }

      editor.focus();

      try { localStorage.setItem(VIM_LS_KEY, '1'); } catch {}
      window.dispatchEvent(new CustomEvent('codeatlas:vim-enabled', {
        detail: { statusBarNode: statusBarNodeRef.current },
      }));
      emitNavLog({ type: 'open', path: openFile.path, detail: 'vim enabled' });

    } catch (err) {
      console.warn('[vim] init failed:', err);
    }
  }, [openFile.path]);

  const disableVim = useCallback(() => {
    vimAdapterRef.current?.dispose();
    vimAdapterRef.current = null;
    editorRef.current?.updateOptions({ lineNumbers: 'on' });
    relNumDisposable.current?.dispose();
    relNumDisposable.current = null;
    if (copyListenerRef.current) {
      copyListenerRef.current.node.removeEventListener('copy', copyListenerRef.current.fn);
      copyListenerRef.current = null;
    }
    try { localStorage.removeItem(VIM_LS_KEY); } catch {}
    window.dispatchEvent(new CustomEvent('codeatlas:vim-disabled'));
  }, []);

  // =========================================================================
  // handleMount
  // =========================================================================

  const handleMount: OnMount = useCallback((editor, monacoInstance) => {
    editorRef.current    = editor;
    monacoRef.current    = monacoInstance as unknown as typeof MonacoType;

    // Register both themes, then apply the current app theme
    const monacoTyped = monacoInstance as unknown as typeof MonacoType;
    registerThemes(monacoTyped);
    const currentTheme = (state?.theme ?? 'dark') as 'dark' | 'light';
    setEditorTheme(monacoTyped, currentTheme);
    applyRootCssVars(currentTheme);

    // Configure all language services
    configureLanguageServices(monacoTyped);

    // Global APIs
    window.__codeatlasEditor  = editor;
    window.__codeatlasMonaco  = monacoInstance as unknown as typeof MonacoType;
    window.__codeatlasVimMode = {
      enable:    () => { void enableVim(); },
      disable:   disableVim,
      isEnabled: () => !!vimAdapterRef.current,
      statusBarNode: statusBarNodeRef.current,
    };

    // Back / forward jump list helpers (Monaco has internal position history)
    window.__codeatlasJumpList = {
      back:    () => runAction(editor, 'workbench.action.navigateBack'),
      forward: () => runAction(editor, 'workbench.action.navigateForward'),
    };

    // Annotation globals
    window.__codeatlasAddAnnotation = (lineNumber, message, severity) => {
      const monaco = monacoRef.current!;
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
    window.__codeatlasClearAnnotations = () => {
      editor.deltaDecorations(decorationIdsRef.current, []);
      decorationIdsRef.current = [];
    };

    // Cursor / selection / content listeners
    editor.onDidChangeCursorPosition(e => {
      onCursorChange(e.position.lineNumber, e.position.column);
      emitNavLog({
        type: 'jump',
        path: editor.getModel()?.uri.path ?? '',
        line: e.position.lineNumber,
      });
    });
    editor.onDidChangeCursorSelection(e => {
      const sel = e.selection;
      onSelectionChange(
        { line: sel.startLineNumber, column: sel.startColumn },
        { line: sel.endLineNumber,   column: sel.endColumn },
      );
    });
    editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model) return;
      const dirty = model.getValue() !== originalContentRef.current;
      onContentChange(dirty);
      if (dirty) {
        emitNavLog({ type: 'edit', path: model.uri.path, line: editor.getPosition()?.lineNumber });
      }
    });

    // Auto-enable vim from localStorage
    const wasEnabled = (() => {
      try { return localStorage.getItem(VIM_LS_KEY) === '1'; } catch { return false; }
    })();
    if (wasEnabled) void enableVim();

    window.dispatchEvent(new CustomEvent('codeatlas:editor-ready', { detail: { editor } }));
    emitNavLog({ type: 'open', path: openFile.path, detail: 'mounted' });

    setEditorReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableVim, disableVim, onCursorChange, onSelectionChange, onContentChange]);

  // Cleanup
  useEffect(() => () => {
    disableVim();
    delete window.__codeatlasEditor;
    delete window.__codeatlasMonaco;
    delete window.__codeatlasVimMode;
    delete window.__codeatlasJumpList;
    delete window.__codeatlasAddAnnotation;
    delete window.__codeatlasClearAnnotations;
  }, [disableVim]);

  // Sync read-only option
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  // ── Reactive theme switching ───────────────────────────────────────────────
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    setEditorTheme(monaco, state.theme as 'dark' | 'light');
  }, [state.theme]);

  return (
    <>
      <Editor
        height="100%"
        theme={state.theme === 'light' ? LIGHT_THEME_ID : DARK_THEME_ID}
        language={openFile.language}
        defaultValue={openFile.content}
        options={{ ...EDITOR_OPTIONS, readOnly }}
        onMount={handleMount}
        loading={
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%',
            color:      state.theme === 'light' ? '#dc2626' : '#ff2d78',
            background: state.theme === 'light' ? '#fafaf2' : '#0c0e1a',
            fontSize: '12px',
            fontFamily: '"JetBrains Mono", monospace',
            letterSpacing: '0.1em',
          }}>
            <span style={{ opacity: 0.5 }}>▸ loading editor…</span>
          </div>
        }
      />
      {/* Error Lens: pure side-effect component */}
      {editorReady && (
        <ErrorLens
          editor={editorRef.current}
          monacoInstance={monacoRef.current}
        />
      )}
    </>
  );
}
