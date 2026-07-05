import { useState } from 'react';
import { ChevronDown, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

// Compact stand-in for an autonomous goal run's internal prompt (planning, task
// driver, verify fix). These prompts are long and machine-facing — rendering
// them as full user bubbles drowns the transcript. Collapsed by default; click
// to reveal the exact prompt that was sent.

const KIND_LABEL: Record<string, string> = {
  goal_plan: 'Planning',
  goal_retry: 'Planning retry',
  goal_task: 'Task',
  goal_verify_fix: 'Verify fix',
};

export default function GoalDriverChip({
  driver, text,
}: {
  driver: { kind: string; label: string };
  text: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-2.5 py-1 text-left hover:bg-accent/20 transition-colors"
        aria-expanded={open}
      >
        <Target className="w-3 h-3 text-primary/70 flex-shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-shrink-0">
          {KIND_LABEL[driver.kind] ?? 'Goal'}
        </span>
        <span className="text-[11px] text-foreground/70 truncate min-w-0">{driver.label}</span>
        <ChevronDown className={cn('w-3 h-3 flex-shrink-0 ml-auto text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <pre className="px-3 py-2 border-t border-border/50 text-[11px] text-foreground/75 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-[50vh] overflow-auto">
          {text}
        </pre>
      )}
    </div>
  );
}
