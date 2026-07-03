// Portal-mounted popup wizard for `<questions_for_user>` blocks. One question
// per screen with roomy per-option cards that carry the choice's `description`
// as its "deep but short" explanation. Escape / backdrop click dismiss without
// submitting; Submit threads the formatted answers back as a user message.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, MessagesSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AgentQuestion } from './blocks';

interface Props {
  open: boolean;
  questions: AgentQuestion[];
  onSubmit: (text: string) => void;
  onDismiss: () => void;
}

function formatAnswers(questions: AgentQuestion[], answers: Record<string, string[]>): string {
  const lines = questions.map((q) => {
    const picked = (answers[q.id] ?? [])
      .map((cid) => q.choices.find((c) => c.id === cid)?.label ?? cid)
      .join(', ');
    return `- ${q.text} → ${picked}`;
  });
  return `Answers to your questions:\n${lines.join('\n')}`;
}

export default function QuestionsDialog({ open, questions, onSubmit, onDismiss }: Props) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);

  const total = questions.length;
  const clampedStep = Math.min(step, Math.max(0, total - 1));
  const q = questions[clampedStep];

  const isAnswered = (question: AgentQuestion) => (answers[question.id]?.length ?? 0) > 0;
  const allAnswered = total > 0 && questions.every(isAnswered);
  const curAnswered = q ? isAnswered(q) : false;
  const isLast = clampedStep === total - 1;

  const toggle = (question: AgentQuestion, choiceId: string) => {
    setAnswers((prev) => {
      const cur = prev[question.id] ?? [];
      if (question.multi) {
        return { ...prev, [question.id]: cur.includes(choiceId) ? cur.filter((c) => c !== choiceId) : [...cur, choiceId] };
      }
      return { ...prev, [question.id]: [choiceId] };
    });
  };

  const go = (delta: number) => {
    setDir(delta);
    setStep((s) => Math.min(total - 1, Math.max(0, s + delta)));
  };
  const jump = (i: number) => {
    setDir(i > clampedStep ? 1 : -1);
    setStep(i);
  };

  const submit = () => {
    if (!allAnswered) return;
    onSubmit(formatAnswers(questions, answers));
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onDismiss(); }
      else if (e.key === 'ArrowRight' && curAnswered && !isLast) { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft' && clampedStep > 0) { e.preventDefault(); go(-1); }
      else if (e.key === 'Enter' && isLast && allAnswered) { e.preventDefault(); submit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `go` and `submit` close over the same state we already list; adding them
    // would just re-run the effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss, curAnswered, isLast, allAnswered, clampedStep]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && q && (
        <motion.div
          className="fixed inset-0 z-[200] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={onDismiss}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="questions-title"
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.12 }}
            className="w-full max-w-xl rounded-lg border border-border bg-popover shadow-xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                <MessagesSquare className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="questions-title" className="text-sm font-semibold text-foreground leading-snug">
                  The agent needs your input
                </h2>
                {total > 1 && (
                  <p className="text-[11px] text-muted-foreground">
                    Question {clampedStep + 1} of {total}
                  </p>
                )}
              </div>
              <button
                onClick={onDismiss}
                title="Close (answers not sent)"
                className="flex-shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-hidden relative">
              <AnimatePresence initial={false} mode="wait" custom={dir}>
                <motion.div
                  key={q.id}
                  custom={dir}
                  initial={{ x: dir * 32, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: dir * -32, opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="h-full overflow-y-auto px-5 py-4 space-y-3"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground leading-snug">
                      {q.text}
                    </p>
                    {q.multi && (
                      <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                        Select all that apply.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    {q.choices.map((c) => {
                      const chosen = (answers[q.id] ?? []).includes(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => toggle(q, c.id)}
                          className={cn(
                            'group flex items-start gap-3 w-full text-left px-3.5 py-3 rounded-lg border transition-colors',
                            chosen
                              ? 'border-primary bg-primary/10'
                              : 'border-border bg-background/40 hover:border-border/80 hover:bg-muted/30',
                          )}
                        >
                          <span
                            className={cn(
                              'mt-0.5 w-4 h-4 flex items-center justify-center flex-shrink-0 border transition-colors',
                              q.multi ? 'rounded-sm' : 'rounded-full',
                              chosen ? 'bg-primary border-primary text-primary-foreground' : 'border-border',
                            )}
                            aria-hidden
                          >
                            {chosen && (q.multi ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 bg-primary-foreground rounded-full" />)}
                          </span>
                          <span className="flex flex-col min-w-0 gap-1">
                            <span className={cn(
                              'text-sm font-medium leading-snug',
                              chosen ? 'text-foreground' : 'text-foreground/90',
                            )}>
                              {c.label}
                            </span>
                            {c.description && (
                              <span className="text-xs text-muted-foreground leading-relaxed">
                                {c.description}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-5 py-3 bg-muted/20 border-t border-border flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => go(-1)}
                disabled={clampedStep === 0}
                aria-label="Previous question"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </Button>

              {total > 1 ? (
                <div className="flex items-center gap-1.5">
                  {questions.map((question, i) => (
                    <button
                      key={question.id}
                      onClick={() => jump(i)}
                      aria-label={`Go to question ${i + 1}`}
                      className={cn(
                        'w-1.5 h-1.5 rounded-full transition-colors',
                        i === clampedStep ? 'bg-primary ring-2 ring-primary/30'
                          : isAnswered(question) ? 'bg-primary/60' : 'bg-border',
                      )}
                    />
                  ))}
                </div>
              ) : (
                <span aria-hidden />
              )}

              {isLast ? (
                <Button
                  size="sm"
                  onClick={submit}
                  disabled={!allAnswered}
                  title={allAnswered ? 'Send answers' : 'Answer every question to continue'}
                >
                  Submit
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => go(1)}
                  disabled={!curAnswered}
                  aria-label="Next question"
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
