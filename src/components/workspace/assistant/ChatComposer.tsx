// apps/branchvisualizer/src/components/workspace/assistant/ChatComposer.tsx
// Message composer — Enter to send, Shift+Enter for newline,
// commit attachment, file attachment trigger.

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { GraphNode } from '@/types';

interface ContextPillProps {
  node: GraphNode;
  onRemove: () => void;
}

function ContextPill({ node, onRemove }: ContextPillProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.1 }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-[9px] font-mono"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-primary/60 flex-shrink-0" />
      <span className="text-primary/80 font-semibold">{node.commit.sha.slice(0, 7)}</span>
      <span className="text-muted-foreground/50 truncate max-w-[100px]">
        {(node.commit.subject ?? node.commit.message).slice(0, 28)}
      </span>
      <button onClick={onRemove} className="text-muted-foreground/40 hover:text-foreground ml-0.5 transition-colors leading-none">×</button>
    </motion.div>
  );
}

interface ChatComposerProps {
  onSend: (text: string, attachedNode?: GraphNode) => void;
  onCancel?: () => void;
  /** Called when user picks a file to attach — parent should fetch and store */
  onAttachFile?: (path: string, ref: string) => void;
  streaming?: boolean;
  disabled?: boolean;
  selectedNode?: GraphNode | null;
}

export default function ChatComposer({
  onSend, onCancel, onAttachFile, streaming = false, disabled = false, selectedNode,
}: ChatComposerProps) {
  const [text, setText] = useState('');
  const [attachedNode, setAttachedNode] = useState<GraphNode | null>(null);
  const [filePath, setFilePath] = useState('');
  const [showFileInput, setShowFileInput] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || streaming || disabled) return;
    onSend(trimmed, attachedNode ?? undefined);
    setText('');
    setAttachedNode(null);
  }, [text, streaming, disabled, onSend, attachedNode]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleAttachFile = useCallback(() => {
    if (!filePath.trim() || !onAttachFile || !selectedNode) return;
    onAttachFile(filePath.trim(), selectedNode.commit.sha);
    setFilePath('');
    setShowFileInput(false);
  }, [filePath, onAttachFile, selectedNode]);

  const canSend = text.trim().length > 0 && !streaming && !disabled;

  return (
    <div className="flex flex-col gap-1 p-2">
      {/* Context chips */}
      <AnimatePresence>
        {attachedNode && (
          <div key="node-pill" className="flex items-center gap-1.5 px-0.5">
            <span className="text-[9px] text-muted-foreground/40 font-medium">Commit:</span>
            <ContextPill node={attachedNode} onRemove={() => setAttachedNode(null)} />
          </div>
        )}
      </AnimatePresence>

      {/* File path input (shown on demand) */}
      <AnimatePresence>
        {showFileInput && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.12 }}
            className="flex items-center gap-1"
          >
            <input
              type="text"
              value={filePath}
              onChange={e => setFilePath(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAttachFile(); if (e.key === 'Escape') setShowFileInput(false); }}
              placeholder="path/to/file.ts (Enter to attach)"
              className="flex-1 text-[10px] px-2 py-1 rounded border border-border/60 bg-muted/30 text-foreground
                         placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 font-mono"
              autoFocus
            />
            <button onClick={() => setShowFileInput(false)} className="text-muted-foreground/40 hover:text-foreground text-sm leading-none px-1">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main input row */}
      <div className={cn(
        'flex items-end gap-1.5 px-2.5 py-2 rounded-xl border transition-all',
        disabled
          ? 'border-border/30 bg-muted/10 opacity-60'
          : streaming
          ? 'border-primary/20 bg-primary/5'
          : 'border-border/60 bg-card/60 focus-within:border-primary/40 focus-within:bg-card',
      )}>
        {/* Action buttons left */}
        <div className="flex items-center gap-0.5 flex-shrink-0 mb-0.5">
          {selectedNode && !attachedNode && (
            <button
              onClick={() => setAttachedNode(selectedNode)}
              title={`Attach commit ${selectedNode.commit.sha.slice(0, 7)}`}
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40
                         hover:text-primary/70 hover:bg-primary/10 transition-colors"
            >
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/>
              </svg>
            </button>
          )}
          {onAttachFile && selectedNode && (
            <button
              onClick={() => setShowFileInput(v => !v)}
              title="Attach file from repo"
              className={cn(
                'w-5 h-5 flex items-center justify-center rounded transition-colors',
                showFileInput
                  ? 'text-primary/70 bg-primary/10'
                  : 'text-muted-foreground/40 hover:text-primary/70 hover:bg-primary/10',
              )}
            >
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6H9.75A1.75 1.75 0 0 1 8 4.25V1.5H3.75Zm5.75.56v2.19c0 .138.112.25.25.25h2.19Zm-9.5-.81A1.75 1.75 0 0 1 3.75 0h5.086c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v8.086A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25V1.25Z"/>
              </svg>
            </button>
          )}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          disabled={disabled || streaming}
          rows={1}
          placeholder={attachedNode ? 'Ask about this commit…' : 'Ask anything about the repository…'}
          className="flex-1 bg-transparent resize-none text-[11px] text-foreground leading-relaxed
                     placeholder:text-muted-foreground/30 focus:outline-none min-h-[20px] max-h-[140px] py-0.5"
        />

        {/* Send / Stop */}
        {streaming ? (
          <button
            onClick={onCancel}
            title="Stop generation"
            className="flex-shrink-0 w-6 h-6 mb-0.5 flex items-center justify-center rounded-lg
                       bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors"
          >
            <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="3" width="10" height="10" rx="1.5"/>
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            title="Send (Enter)"
            className={cn(
              'flex-shrink-0 w-6 h-6 mb-0.5 flex items-center justify-center rounded-lg transition-all duration-100',
              canSend
                ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm'
                : 'bg-muted/30 text-muted-foreground/20 cursor-not-allowed',
            )}
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
              <path d="M.989 8 .064 2.68a1.342 1.342 0 0 1 1.85-1.462l13.402 5.744a1.13 1.13 0 0 1 0 2.076L1.913 14.782a1.342 1.342 0 0 1-1.85-1.463L.99 8Zm.603-5.288L2.38 7.25h4.87a.75.75 0 0 1 0 1.5H2.38l-.788 4.538L13.929 8Z"/>
            </svg>
          </button>
        )}
      </div>

      <p className="text-[9px] text-muted-foreground/20 px-0.5">
        Enter ↵ send · Shift+Enter new line
      </p>
    </div>
  );
}
