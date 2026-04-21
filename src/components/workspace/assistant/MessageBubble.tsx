// apps/branchvisualizer/src/components/workspace/assistant/MessageBubble.tsx
// Renders a single chat message with copy buttons on code blocks.

import { memo, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { AssistantMessage, TokenUsage } from '@/store/assistantStore';

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // fallback
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }, [text]);

  return (
    <button
      onClick={copy}
      title="Copy"
      className={cn(
        'absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium transition-all',
        copied
          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
          : 'bg-muted/60 text-muted-foreground/60 border border-border/40 hover:text-foreground hover:bg-muted',
      )}
    >
      {copied ? '✓ copied' : 'copy'}
    </button>
  );
}

// ─── Inline markdown renderer ─────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|_[^_]+_|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const raw = match[0];
    if (raw.startsWith('`')) {
      parts.push(
        <code key={key++} className="px-1 py-0.5 rounded text-[10px] font-mono bg-muted/60 text-foreground border border-border/40">
          {raw.slice(1, -1)}
        </code>,
      );
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      parts.push(<strong key={key++} className="font-semibold">{raw.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={key++} className="italic opacity-80">{raw.slice(1, -1)}</em>);
    }
    last = match.index + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ─── Block renderer ───────────────────────────────────────────────────────────

function CodeBlock({ lang, lines }: { lang: string; lines: string[] }) {
  const text = lines.join('\n');

  // For diff blocks, extract the filename from the "+++ b/path" header line so
  // we can offer an "open in editor" button (fires a DOM event for the future editor tab).
  const filename = lang === 'diff'
    ? (lines.find(l => l.startsWith('+++ b/'))?.slice(6).trim() ?? null)
    : null;

  const openInEditor = () => {
    if (!filename) return;
    window.dispatchEvent(new CustomEvent('codeatlas:open-file', { detail: { path: filename } }));
  };

  return (
    <div className="relative my-2 group">
      <div className="flex items-center justify-between px-2.5 py-1 rounded-t-lg bg-muted/50 border border-border/50 border-b-0">
        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wide">
          {lang || 'code'}
          {filename && (
            <span className="ml-1.5 normal-case text-muted-foreground/40 truncate max-w-[120px] inline-block align-bottom">
              {filename.split('/').pop()}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {filename && (
            <button
              onClick={openInEditor}
              title={`Open ${filename} in editor`}
              className="px-1.5 py-0.5 rounded text-[9px] font-medium transition-all
                         bg-muted/60 text-muted-foreground/50 border border-border/40
                         hover:text-foreground hover:bg-muted hover:border-border/70"
            >
              open
            </button>
          )}
          <CopyBtn text={text} />
        </div>
      </div>
      <pre className="p-2.5 rounded-b-lg bg-muted/30 border border-border/50 overflow-x-auto">
        <code className={cn('text-[10px] font-mono text-foreground/90 leading-relaxed', lang === 'diff' && 'whitespace-pre')}>
          {lang === 'diff'
            ? lines.map((l, i) => (
                <span key={i} className={cn(
                  'block',
                  l.startsWith('+') && !l.startsWith('+++') && 'text-green-500 dark:text-green-400 bg-green-500/8',
                  l.startsWith('-') && !l.startsWith('---') && 'text-red-500 dark:text-red-400 bg-red-500/8',
                  l.startsWith('@@') && 'text-blue-500 dark:text-blue-400 font-medium',
                )}>
                  {l}
                </span>
              ))
            : text
          }
        </code>
      </pre>
    </div>
  );
}

function renderContent(content: string): React.ReactNode {
  const lines = content.split('\n');
  const result: React.ReactNode[] = [];
  let i = 0;
  let listItems: React.ReactNode[] = [];
  let codeLines: string[] = [];
  let inCode = false;
  let codeLang = '';

  const flushList = () => {
    if (!listItems.length) return;
    result.push(<ul key={`ul-${i}`} className="my-1.5 space-y-0.5 pl-3">{listItems}</ul>);
    listItems = [];
  };
  const flushCode = () => {
    if (!codeLines.length) return;
    result.push(<CodeBlock key={`code-${i}`} lang={codeLang} lines={codeLines} />);
    codeLines = [];
    codeLang = '';
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCode) { flushCode(); inCode = false; }
      else { flushList(); codeLang = line.slice(3).trim(); inCode = true; }
      i++; continue;
    }
    if (inCode) { codeLines.push(line); i++; continue; }

    if (/^#{1,3}\s/.test(line)) {
      flushList();
      const level = (line.match(/^(#{1,3})/)?.[1].length ?? 1);
      const text = line.replace(/^#{1,3}\s+/, '');
      const cls = level === 1
        ? 'text-sm font-bold text-foreground mt-3 mb-1 first:mt-0'
        : level === 2
        ? 'text-xs font-bold text-foreground mt-2 mb-1 first:mt-0'
        : 'text-[11px] font-semibold text-foreground/90 mt-1.5 mb-0.5';
      result.push(<p key={`h-${i}`} className={cls}>{renderInline(text)}</p>);
      i++; continue;
    }

    if (/^[-*]\s/.test(line)) {
      listItems.push(
        <li key={`li-${i}`} className="flex gap-1.5 text-[11px] text-foreground/90 leading-relaxed">
          <span className="text-muted-foreground/50 mt-0.5 flex-shrink-0">•</span>
          <span>{renderInline(line.replace(/^[-*]\s/, ''))}</span>
        </li>,
      );
      i++; continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\./)?.[1] ?? '1';
      listItems.push(
        <li key={`ol-${i}`} className="flex gap-1.5 text-[11px] text-foreground/90 leading-relaxed">
          <span className="text-muted-foreground/50 font-mono text-[10px] mt-0.5 flex-shrink-0 w-4">{num}.</span>
          <span>{renderInline(line.replace(/^\d+\.\s/, ''))}</span>
        </li>,
      );
      i++; continue;
    }

    flushList();
    if (line.trim() === '') {
      if (result.length > 0) result.push(<div key={`sp-${i}`} className="h-1.5" />);
    } else {
      result.push(
        <p key={`p-${i}`} className="text-[11px] text-foreground/90 leading-relaxed">
          {renderInline(line)}
        </p>,
      );
    }
    i++;
  }
  flushList();
  if (inCode) flushCode();
  return <>{result}</>;
}

// ─── Token usage stats ────────────────────────────────────────────────────────

function TokenStats({ usage }: { usage: TokenUsage }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] text-muted-foreground/25 font-mono"
      title={`Input: ${usage.input.toLocaleString()} tokens · Output: ${usage.output.toLocaleString()} tokens · Total: ${usage.total.toLocaleString()} tokens`}
    >
      {usage.input > 0 && <span>↑{usage.input >= 1000 ? `${(usage.input / 1000).toFixed(1)}k` : usage.input}</span>}
      <span>↓{usage.output >= 1000 ? `${(usage.output / 1000).toFixed(1)}k` : usage.output}</span>
    </span>
  );
}

// ─── Streaming cursor ─────────────────────────────────────────────────────────

function Cursor() {
  return <span className="inline-block w-1.5 h-3.5 bg-primary/70 rounded-sm ml-0.5 animate-pulse align-middle" />;
}

// ─── Bubble ───────────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: AssistantMessage;
  isLatest: boolean;
}

const MessageBubble = memo(function MessageBubble({ message, isLatest }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isStreaming = !!message.streaming && isLatest;
  if (message.role === 'system') return null;

  return (
    <div className={cn('flex gap-2 items-start py-0.5', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 mt-0.5 border',
        isUser
          ? 'bg-primary/20 border-primary/30 text-primary dark:text-primary-foreground'
          : 'bg-muted border-border/60 text-muted-foreground',
      )}>
        {isUser ? 'Y' : '✦'}
      </div>

      <div className={cn('flex flex-col gap-1 max-w-[86%]', isUser && 'items-end')}>
        {/* Context chip */}
        {message.context?.sha && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono
                           bg-muted/40 border-border/50 text-muted-foreground/80">
            <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" className="opacity-60">
              <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/>
            </svg>
            <span>{message.context.sha.slice(0, 7)}</span>
            {message.context.commitSubject && (
              <span className="opacity-60 truncate max-w-[140px]">{message.context.commitSubject.slice(0, 50)}</span>
            )}
          </span>
        )}

        {/* Content bubble */}
        <div className={cn(
          'px-3 py-2.5 rounded-2xl text-[11px] leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm shadow-sm'
            : 'bg-card text-foreground border border-border/60 rounded-tl-sm shadow-sm',
        )}>
          {isUser
            ? <p className="whitespace-pre-wrap">{message.content}</p>
            : <div>{renderContent(message.content || (isStreaming ? '' : '_No response_'))}{isStreaming && <Cursor />}</div>
          }
        </div>

        {/* Timestamp + token stats */}
        <div className={cn('flex items-center gap-2 px-0.5', isUser && 'flex-row-reverse')}>
          <span className="text-[9px] text-muted-foreground/30">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {!isUser && message.tokenUsage && (
            <TokenStats usage={message.tokenUsage} />
          )}
        </div>
      </div>
    </div>
  );
});

export default MessageBubble;
