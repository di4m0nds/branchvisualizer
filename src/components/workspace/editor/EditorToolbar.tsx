// apps/branchvisualizer/src/components/workspace/editor/EditorToolbar.tsx
// Phase 8 -- Toolbar for the editor tab: view mode toggle, Vim toggle, Ask AI button.

import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/store/AppContext';
import { useCapabilities } from '@/hooks/useCapabilities';
import { getEditorState } from '@/hooks/useAi';
import type { OpenFile } from '@/types';

export type ViewMode = 'editor' | 'preview' | 'diff' | 'split';

interface EditorToolbarProps {
  openFile: OpenFile | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  vimEnabled: boolean;
  onVimToggle: () => void;
}

export function EditorToolbar({
  openFile,
  viewMode,
  onViewModeChange,
  vimEnabled,
  onVimToggle,
}: EditorToolbarProps) {
  const { state, dispatch } = useAppContext();
  const { hasCapability } = useCapabilities();

  const ext = openFile?.path.split('.').pop()?.toLowerCase();
  const isMarkdown = ext === 'md' || ext === 'mdx';
  const isPdf = ext === 'pdf';
  const isDocx = ext === 'docx' || ext === 'doc';
  const canPreview = isMarkdown || isPdf || isDocx;

  const handleAskAI = useCallback(() => {
    const editorState = getEditorState(openFile ?? null);
    if (!editorState) return;

    const prompt = editorState.selectedText.trim()
      ? [
          `Explain this code from \`${editorState.path}\` (around line ${editorState.cursorLine}):`,
          '',
          '```' + editorState.language,
          editorState.selectedText,
          '```',
          '',
          'Be concise. Cover: what it does, edge cases, potential improvements.',
        ].join('\n')
      : [
          `Explain the file \`${editorState.path}\` [${editorState.language}].`,
          '',
          'Answer:',
          '1. What is the purpose of this file?',
          '2. What are the key exports / functions?',
          '3. Any notable patterns or dependencies?',
          '',
          `(Visible range: lines ${editorState.visibleRangeStart}–${editorState.visibleRangeEnd})`,
        ].join('\n');

    // Dispatch editor mode: AssistantTab creates a new session with this prompt.
    dispatch({ type: 'REQUEST_AI_CHAT', shas: [], mode: 'editor', editorPrompt: prompt });
    dispatch({ type: 'SET_ACTIVE_TAB', tab: 'assistant' });
  }, [openFile, dispatch]);

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-muted/10 flex-shrink-0 min-w-0 overflow-x-auto">
      {/* File path breadcrumb */}
      <span className="text-xs text-muted-foreground truncate flex-1 min-w-0 mr-2 font-mono">
        {openFile ? openFile.path : 'No file open'}
        {openFile?.isDirty && <span className="text-amber-400 ml-1">●</span>}
      </span>

      {/* View mode buttons */}
      <div className="flex items-center gap-0.5 p-0.5 rounded border border-border bg-muted/30 flex-shrink-0">
        <ViewModeBtn id="editor" label="Code" active={viewMode === 'editor'} onClick={() => onViewModeChange('editor')} />
        {canPreview && (
          <ViewModeBtn id="preview" label="Preview" active={viewMode === 'preview'} onClick={() => onViewModeChange('preview')} />
        )}
        {canPreview && !isPdf && !isDocx && (
          <ViewModeBtn id="split" label="Split" active={viewMode === 'split'} onClick={() => onViewModeChange('split')} />
        )}
        <ViewModeBtn id="diff" label="Diff" active={viewMode === 'diff'} onClick={() => onViewModeChange('diff')} />
      </div>

      <div className="h-4 w-px bg-border flex-shrink-0 mx-0.5" />

      {/* Vim toggle */}
      <button
        onClick={onVimToggle}
        title={vimEnabled ? 'Disable Vim mode' : 'Enable Vim mode'}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors flex-shrink-0',
          vimEnabled
            ? 'bg-primary/20 text-primary border border-primary/40'
            : 'text-muted-foreground hover:text-foreground border border-transparent hover:border-border',
        )}
      >
        VIM
      </button>

      {/* Save button (disabled in Phase 8 -- write:repo is Phase 10) */}
      <button
        disabled={!hasCapability('write:repo' as never) || !openFile?.isDirty}
        title="Save (requires write:repo capability -- Phase 10)"
        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors flex-shrink-0
                   text-muted-foreground/40 cursor-not-allowed border border-transparent"
      >
        <SaveIcon />
        Save
      </button>

      {/* Ask AI button */}
      {hasCapability('ai:assist') && openFile && (
        <button
          onClick={handleAskAI}
          title="Ask AI about this file / selection"
          className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors flex-shrink-0
                     text-muted-foreground hover:text-foreground hover:bg-accent/20 border border-transparent hover:border-border"
        >
          <AiIcon />
          Ask AI
        </button>
      )}

      {/* Close button */}
      {openFile && (
        <button
          onClick={() => dispatch({ type: 'CLOSE_FILE' })}
          title="Close file"
          className="flex items-center justify-center w-6 h-6 rounded text-muted-foreground
                     hover:text-foreground hover:bg-accent/20 transition-colors flex-shrink-0"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
          </svg>
        </button>
      )}

      {/* Prevent state warning */}
      {void state, null}
    </div>
  );
}

function ViewModeBtn({ id, label, active, onClick }: { id: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      key={id}
      onClick={onClick}
      className={cn(
        'px-2 py-0.5 rounded text-xs transition-colors',
        active
          ? 'bg-accent text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function SaveIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM3 2.5v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H10V5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V2.5H3.25a.25.25 0 0 0-.25.25ZM10 2.5H6V5h4V2.5Z"/>
    </svg>
  );
}

function AiIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 13H8.061l-2.574 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Z"/>
    </svg>
  );
}
