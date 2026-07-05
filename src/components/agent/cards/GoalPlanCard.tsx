import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GoalTask } from '@/types/goals';

// ─── Goal-plan card ──────────────────────────────────────────────────────────
// Renders the goal executor's <goal_plan> JSON task array as a readable task
// list in the transcript (instead of raw JSON). Live progress lives in
// Monitor → Goals; this card is the plan as proposed.

export function GoalPlanCard({ data }: { data: Record<string, unknown> }) {
  const tasks = (data.tasks as GoalTask[] | undefined) ?? [];
  const [open, setOpen] = useState(() => tasks.length <= 8);

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-2.5 py-1 border-b border-primary/20 text-left hover:bg-primary/10 transition-colors"
        aria-expanded={open}
      >
        <Target className="w-3 h-3 text-primary flex-shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-primary flex-shrink-0">Goal plan</span>
        {tasks.length > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground/70 flex-shrink-0">
            · {tasks.length} task{tasks.length === 1 ? '' : 's'}
          </span>
        )}
        {!open && tasks[0] && (
          <span className="text-[11px] text-foreground/80 truncate min-w-0">{tasks[0].title}…</span>
        )}
        <ChevronDown className={cn('w-3 h-3 flex-shrink-0 text-muted-foreground transition-transform ml-auto', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            {tasks.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-muted-foreground/70">
                No parseable tasks in this plan block.
              </p>
            ) : (
              <ol className="px-2 py-1.5 space-y-1 max-h-[60vh] overflow-auto">
                {tasks.map((t) => (
                  <li key={t.id} className="rounded-md border border-border/50 bg-background/40 px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">{t.id}</span>
                      <span className="text-xs font-medium text-foreground flex-1 min-w-0">{t.title}</span>
                      {t.needsApproval && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 flex-shrink-0">approval</span>
                      )}
                    </div>
                    {t.description && t.description !== t.title && (
                      <p className="text-[11px] text-foreground/75 mt-0.5 leading-snug">{t.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-0.5">
                      {t.deps.length > 0 && (
                        <span className="text-[9px] font-mono text-muted-foreground/50">after {t.deps.join(', ')}</span>
                      )}
                      {t.verify?.command && (
                        <span className="text-[9px] font-mono text-muted-foreground/50 truncate" title={t.verify.command}>
                          verify: {t.verify.command}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
