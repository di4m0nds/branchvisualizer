import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanStep } from '../blocks';
import Markdown from '../Markdown';

// ─── Plan card ───────────────────────────────────────────────────────────────

const COMPLEXITY_TONE: Record<string, string> = {
  low: 'text-green-400', medium: 'text-yellow-400', high: 'text-red-400', complex: 'text-red-400',
};
const STEP_STATUS_TONE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground', in_progress: 'bg-primary/15 text-primary',
  complete: 'bg-green-500/15 text-green-400', blocked: 'bg-red-500/15 text-red-400',
};

export function PlanCard({ data }: { data: Record<string, unknown> }) {
  const title = String(data.planTitle ?? '');
  const objective = String(data.objective ?? '');
  const inScope = String(data.inScope ?? '');
  const outOfScope = String(data.outOfScope ?? '');
  const complexity = String(data.complexity ?? '');
  const steps = (data.steps as PlanStep[] | undefined) ?? [];
  // Markdown-body plans (no <step> schema) fall back to raw markdown + a
  // derived step count/titles so the card is never blank.
  const markdownFallback = String(data.markdownFallback ?? '');
  const derivedStepTitles = (data.derivedStepTitles as string[] | undefined) ?? [];
  // A markdown plan with no numbered list / headings still counts as "long"
  // enough to collapse — but the label + summary below keep it non-empty.
  const stepCount = steps.length || Number(data.derivedStepCount ?? 0) || (markdownFallback ? 7 : 0);

  // First objective line, used as a title fallback so a collapsed card without
  // an explicit <title> still reads as something.
  const objectiveLine = objective.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const stepTitles = steps.length > 0 ? steps.map((s) => s.title).filter(Boolean) : derivedStepTitles;
  const headerLabel = title
    || objectiveLine.replace(/[*_`#]/g, '').slice(0, 80)
    || stepTitles[0]
    || 'Implementation plan';
  const summaryLine = stepTitles.length > 0
    ? stepTitles.slice(0, 3).join(' · ') + (stepTitles.length > 3 ? ` +${stepTitles.length - 3} more` : '')
    : '';

  // Long plans dominate the transcript — collapse them by default with a
  // one-line summary; short plans stay open so nothing hides.
  const [open, setOpen] = useState(() => stepCount <= 6);

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex flex-col w-full px-2.5 py-1 border-b border-primary/20 text-left hover:bg-primary/10 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 w-full">
          <ClipboardList className="w-3 h-3 text-primary flex-shrink-0" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary flex-shrink-0">Plan</span>
          {!open && (
            <span className="text-[11px] text-foreground/80 truncate min-w-0">{headerLabel}</span>
          )}
          {!open && stepCount > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground/70 flex-shrink-0">
              · {stepCount} step{stepCount === 1 ? '' : 's'}
            </span>
          )}
          {complexity && (
            <span className={cn('ml-auto text-[10px] font-medium flex-shrink-0', COMPLEXITY_TONE[complexity.toLowerCase()] ?? 'text-muted-foreground')}>
              {complexity}
            </span>
          )}
          <ChevronDown className={cn('w-3 h-3 flex-shrink-0 text-muted-foreground transition-transform', open ? 'rotate-180' : '', !complexity && 'ml-auto')} />
        </div>
        {!open && summaryLine && (
          <span className="text-[10px] text-muted-foreground/70 truncate min-w-0 pl-5 mt-0.5">{summaryLine}</span>
        )}
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
            <div className="px-3 py-2 space-y-2">
              {title && <div className="text-sm font-semibold text-foreground">{title}</div>}
              {/* Markdown for the objective — the model routinely uses backticks
                  / bullets here and plain text swallowed all of it. */}
              {objective && <div className="text-[13px] text-foreground/90 leading-relaxed"><Markdown text={objective} /></div>}
              {(inScope || outOfScope) && (
                <div className="grid sm:grid-cols-2 gap-2 text-[11px]">
                  {inScope && <ScopeBox label="In scope" tone="text-green-400" body={inScope} />}
                  {outOfScope && <ScopeBox label="Out of scope" tone="text-muted-foreground" body={outOfScope} />}
                </div>
              )}
              {steps.length === 0 && markdownFallback && (
                <div className="text-[12px] text-foreground/85 leading-relaxed max-h-[70vh] overflow-auto pr-1">
                  <Markdown text={markdownFallback} />
                </div>
              )}
              {steps.length > 0 && (
                // Cap the step list so a 40-step plan doesn't push the whole
                // transcript down; users scroll the plan on its own.
                <ol className="space-y-1.5 mt-1 max-h-[70vh] overflow-auto pr-1">
                  {steps.map((s) => (
                    <li key={s.index} className="rounded-md border border-border/50 bg-background/40 px-2.5 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-muted-foreground">{s.index}</span>
                        <span className="text-xs font-medium text-foreground flex-1 min-w-0">{s.title}</span>
                        {s.complexity && <span className={cn('text-[9px]', COMPLEXITY_TONE[s.complexity.toLowerCase()] ?? 'text-muted-foreground')}>{s.complexity}</span>}
                        <span className={cn('text-[9px] px-1.5 py-0.5 rounded', STEP_STATUS_TONE[s.status] ?? 'bg-muted text-muted-foreground')}>{s.status.replace(/_/g, ' ')}</span>
                      </div>
                      {s.description && (
                        <div className="text-[11px] text-foreground/80 mt-1 leading-relaxed">
                          <Markdown text={s.description} />
                        </div>
                      )}
                      {s.filesAffected && s.filesAffected.toLowerCase() !== 'none' && (
                        <div className="text-[10px] font-mono text-muted-foreground mt-1 truncate" title={s.filesAffected}>📄 {s.filesAffected}</div>
                      )}
                      {s.risks && s.risks.toLowerCase() !== 'none' && (
                        <div className="text-[10px] text-amber-500/90 mt-0.5">⚠ {s.risks}</div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ScopeBox({ label, tone, body }: { label: string; tone: string; body: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1.5">
      <div className={cn('text-[9px] font-semibold uppercase tracking-wider mb-0.5', tone)}>{label}</div>
      <div className="text-foreground/80 leading-snug">
        <Markdown text={body} />
      </div>
    </div>
  );
}
