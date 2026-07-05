import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useAppSelector } from '@/store/store';
import { cn, copyToClipboard } from '@/lib/utils';
import type { GraphNode } from '@/types';
import { extractPRNumber } from './extractPRNumber';

// ─── Shared header ────────────────────────────────────────────────────────────

interface HeaderProps {
  node: GraphNode;
  mode: 'floating' | 'inline';
  minimized: boolean;
  onMinimize: () => void;
  onClose: () => void;
  onDragHandleMouseDown?: (e: React.MouseEvent) => void;
}

export default function PanelHeader({ node, mode, minimized, onMinimize, onClose, onDragHandleMouseDown }: HeaderProps) {
  const graphData = useAppSelector((s) => s.graphData);
  const repoInfo = useAppSelector((s) => s.repoInfo);
  const [copied, setCopied] = useState(false);

  const { commit, color } = node;
  const tags = graphData?.tagMap.get(commit.sha) ?? [];
  const branches = graphData?.branchMap.get(commit.sha) ?? [];
  const prNumber = commit.isMerge ? extractPRNumber(commit.subject, commit.body) : null;
  const prUrl = prNumber && repoInfo ? `${repoInfo.url}/pull/${prNumber}` : null;

  async function handleCopy() {
    await copyToClipboard(commit.sha);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 flex-shrink-0 border-b border-border',
        mode === 'floating' ? 'px-4 py-3' : 'px-3 py-2',
        mode === 'floating' && 'cursor-grab active:cursor-grabbing select-none',
      )}
      onMouseDown={mode === 'floating' ? onDragHandleMouseDown : undefined}
    >
      {mode === 'floating' && (
        <div className="flex-shrink-0 flex flex-col gap-[3px] pr-1 opacity-30">
          <div className="w-3 h-px bg-current rounded-full" />
          <div className="w-3 h-px bg-current rounded-full" />
          <div className="w-3 h-px bg-current rounded-full" />
        </div>
      )}

      <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
        <button
          onClick={handleCopy}
          onMouseDown={e => e.stopPropagation()}
          title={copied ? 'Copied!' : `Copy SHA: ${commit.sha}`}
          className="flex items-center gap-1 group flex-shrink-0"
        >
          <code className="text-sm font-mono font-bold tracking-wide" style={{ color }}>
            {commit.shortSha}
          </code>
          <span className={cn(
            'transition-opacity',
            copied ? 'text-green-400 opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-70'
          )}>
            {copied ? <CheckIcon className="w-3 h-3" /> : <CopyIcon className="w-3 h-3" />}
          </span>
        </button>

        {commit.isMerge && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium
                           bg-purple-500/10 border border-purple-500/25 text-purple-400 flex-shrink-0">
            merge
          </span>
        )}
        {prUrl && (
          <a href={prUrl} target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium flex-shrink-0
                       bg-purple-500/10 border border-purple-500/25 text-purple-400
                       hover:bg-purple-500/20 transition-colors flex items-center gap-0.5"
          >
            #{prNumber}
            <svg width="7" height="7" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 10L10 2M10 2H5M10 2v5" />
            </svg>
          </a>
        )}

        {branches.slice(0, 2).map(b => (
          <span key={b.name}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border truncate max-w-[80px] flex-shrink-0"
            style={{ color, borderColor: `${color}45`, background: `${color}12` }}
            title={b.name}
          >
            {b.name}
          </span>
        ))}
        {branches.length > 2 && (
          <span className="text-[10px] text-muted-foreground flex-shrink-0">+{branches.length - 2}</span>
        )}

        {tags.slice(0, 1).map(t => (
          <span key={t.name}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium flex-shrink-0
                       bg-amber-500/10 border border-amber-500/25 text-amber-500 truncate max-w-[80px]"
            title={t.name}
          >
            🏷 {t.name}
          </span>
        ))}
      </div>

      <div
        className="flex items-center gap-0.5 flex-shrink-0 ml-1"
        onMouseDown={e => e.stopPropagation()}
      >
        {mode === 'floating' && (
          <button
            onClick={onMinimize}
            title={minimized ? 'Expand' : 'Minimize'}
            className="w-5 h-5 rounded flex items-center justify-center
                       text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {minimized ? (
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <path d="M2 6.5l3-3 3 3" />
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <line x1="1.5" y1="5" x2="8.5" y2="5" />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={onClose}
          title="Close (Esc)"
          className="w-5 h-5 rounded flex items-center justify-center
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
