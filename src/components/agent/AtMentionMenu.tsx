// ─── @-mention file picker ──────────────────────────────────────────────────
// Dropdown above the composer listing fuzzy-matched workspace paths. Dumb by
// design: the parent owns the query, match list, and active index; this only
// renders rows and reports clicks. Keyboard handling lives in the composer's
// onKeyDown so arrows/Tab/Enter never fight the textarea.

import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileIcon } from '@/components/workspace/FilesTabPrimitives';
import type { TreeEntry } from '@/hooks/useWorkspaceTree';

export default function AtMentionMenu({
  matches, activeIndex, loading, hint, onSelect, onHover,
}: {
  matches: TreeEntry[];
  activeIndex: number;
  loading: boolean;
  /** Shown instead of matches (e.g. "local sessions only"). */
  hint?: string;
  onSelect: (entry: TreeEntry) => void;
  onHover: (index: number) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4, scaleY: 0.95 }}
      animate={{ opacity: 1, y: 0, scaleY: 1 }}
      exit={{ opacity: 0, y: 4, scaleY: 0.95 }}
      transition={{ duration: 0.13 }}
      style={{ transformOrigin: 'bottom' }}
      className="absolute bottom-full left-0 right-0 z-50 mb-1.5
                 rounded-lg border border-border bg-card shadow-lg overflow-hidden"
    >
      <div className="max-h-64 overflow-y-auto py-1">
        {hint ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">{hint}</div>
        ) : loading && matches.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Indexing workspace…
          </div>
        ) : matches.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">No matching files</div>
        ) : (
          matches.map((entry, i) => {
            const dir = entry.path.slice(0, Math.max(entry.path.length - entry.name.length - 1, 0));
            return (
              <div
                key={entry.path}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors duration-75',
                  i === activeIndex ? 'bg-accent/50' : 'hover:bg-accent/40',
                )}
                onMouseEnter={() => onHover(i)}
                onMouseDown={(e) => { e.preventDefault(); onSelect(entry); }}
              >
                <FileIcon name={entry.name} type={entry.isDir ? 'tree' : 'blob'} />
                <span className="text-xs font-mono text-foreground whitespace-nowrap">
                  {entry.name}{entry.isDir ? '/' : ''}
                </span>
                {dir && (
                  <span className="flex-1 min-w-0 text-[10px] font-mono text-muted-foreground/60 truncate">
                    {dir}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="px-3 py-1 border-t border-border/50 text-[10px] text-muted-foreground/50 flex items-center gap-1">
        <span className="font-mono border border-border/60 rounded px-1 text-[9px]">↑↓</span>
        <span>navigate</span>
        <span className="ml-1 font-mono border border-border/60 rounded px-1 text-[9px]">Tab</span>
        <span className="font-mono border border-border/60 rounded px-1 text-[9px]">Enter</span>
        <span>attach</span>
        <span className="ml-1 font-mono border border-border/60 rounded px-1 text-[9px]">Esc</span>
        <span>dismiss</span>
      </div>
    </motion.div>
  );
}
