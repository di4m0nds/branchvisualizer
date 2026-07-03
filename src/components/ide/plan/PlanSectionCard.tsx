// One selectable section of the implementation plan. Renders its own heading
// (Markdown intentionally degrades headings) and the section body as markdown,
// with an inline comment thread below.

import { cn } from '@/lib/utils';
import Markdown from '@/components/agent/Markdown';
import type { PlanComment } from '@/types/session';
import type { PlanSection } from '@/lib/agent/plan';
import PlanComments from './PlanComments';

interface Props {
  section: PlanSection;
  comments: PlanComment[];
  selected: boolean;
  onSelect: () => void;
  onAddComment: (text: string) => void;
  onRemoveComment: (id: string) => void;
  onResolveComment: (id: string) => void;
}

const HEADING_SIZE: Record<number, string> = {
  1: 'text-base font-bold',
  2: 'text-sm font-bold',
  3: 'text-sm font-semibold',
  4: 'text-xs font-semibold',
  5: 'text-xs font-semibold',
  6: 'text-xs font-semibold',
};

export default function PlanSectionCard({
  section, comments, selected, onSelect,
  onAddComment, onRemoveComment, onResolveComment,
}: Props) {
  const unresolved = comments.filter((c) => !c.resolved).length;

  return (
    <div
      onClick={onSelect}
      className={cn(
        'rounded-lg border transition-colors cursor-default',
        selected ? 'border-primary/40 bg-primary/[0.04] ring-1 ring-inset ring-primary/25' : 'border-border/60 bg-muted/10 hover:border-border',
      )}
    >
      {section.heading && (
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <h3 className={cn('text-foreground min-w-0 truncate', HEADING_SIZE[section.level] ?? 'text-sm font-semibold')}>
            {section.heading}
          </h3>
          {unresolved > 0 && (
            <span className="ml-auto flex-shrink-0 px-1.5 py-[1px] rounded-full bg-amber-500/15 text-amber-500 text-[10px] font-medium leading-none">
              {unresolved} comment{unresolved === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {section.body && (
        <div className="px-3 py-2">
          <Markdown text={section.body} />
        </div>
      )}

      <div className="px-3 pb-2.5 pt-1 border-t border-border/40 mt-1">
        <PlanComments
          comments={comments}
          onAdd={onAddComment}
          onRemove={onRemoveComment}
          onResolveToggle={onResolveComment}
        />
      </div>
    </div>
  );
}
