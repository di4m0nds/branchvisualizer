import { AnimatePresence, motion } from 'framer-motion';
import { useAppSelector } from '@/store/store';
import { cn } from '@/lib/utils';
import type { GraphNode } from '@/types';
import { extractPRNumber } from './extractPRNumber';
import { useCommitDetails } from './useCommitDetails';
import CommitDetailsBody from './CommitDetailsBody';

// ─── Single accordion item for multi-select panel ────────────────────────────

export default function AccordionItem({
  node,
  isExpanded,
  onToggle,
  onDeselect,
}: {
  node: GraphNode;
  isExpanded: boolean;
  onToggle: () => void;
  onDeselect: () => void;
}) {
  const graphData = useAppSelector((s) => s.graphData);
  const { commitDetails, detailsLoading } = useCommitDetails(isExpanded ? node : null);

  const { commit, color } = node;
  const branches = graphData?.branchMap.get(commit.sha) ?? [];
  const tags = graphData?.tagMap.get(commit.sha) ?? [];
  const prNumber = commit.isMerge ? extractPRNumber(commit.subject, commit.body) : null;

  return (
    <div className="border-b border-border/70 last:border-b-0">
      {/* Accordion header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors group"
        onClick={onToggle}
      >
        {/* Color dot */}
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />

        {/* SHA */}
        <code className="text-[11px] font-mono flex-shrink-0" style={{ color }}>
          {commit.shortSha}
        </code>

        {/* Merge badge */}
        {commit.isMerge && (
          <span className="px-1 py-0.5 rounded text-[9px] font-mono flex-shrink-0
                           bg-purple-500/10 border border-purple-500/25 text-purple-400">
            merge
          </span>
        )}
        {prNumber && (
          <span className="text-[9px] font-mono text-purple-400 flex-shrink-0">#{prNumber}</span>
        )}

        {/* Branch/tag badges */}
        {branches.slice(0, 1).map(b => (
          <span key={b.name}
            className="px-1 py-0.5 rounded text-[9px] font-mono border truncate max-w-[70px] flex-shrink-0"
            style={{ color, borderColor: `${color}45`, background: `${color}12` }}
            title={b.name}
          >
            {b.name}
          </span>
        ))}
        {tags.slice(0, 1).map(t => (
          <span key={t.name}
            className="px-1 py-0.5 rounded text-[9px] font-mono flex-shrink-0
                       bg-amber-500/10 border border-amber-500/25 text-amber-500 truncate max-w-[70px]"
            title={t.name}
          >
            🏷 {t.name}
          </span>
        ))}

        {/* Subject */}
        <span className="flex-1 min-w-0 text-xs text-foreground truncate">
          {commit.subject}
        </span>

        {/* Chevron */}
        <svg
          width="9" height="9" viewBox="0 0 10 10" fill="none"
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
          className={cn(
            'flex-shrink-0 text-muted-foreground transition-transform duration-200',
            isExpanded && 'rotate-180',
          )}
        >
          <path d="M2 3.5l3 3 3-3" />
        </svg>

        {/* Deselect button */}
        <span
          role="button"
          title="Remove from selection"
          onClick={e => { e.stopPropagation(); onDeselect(); }}
          className="flex-shrink-0 w-4 h-4 rounded flex items-center justify-center
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
        >
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </span>
      </button>

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <CommitDetailsBody node={node} details={commitDetails} detailsLoading={detailsLoading} variant="floating" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
