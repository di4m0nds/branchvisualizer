import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { AgentBlock } from '@/types/session';
import type { LogDensity } from '@/types';
import { parseQuestions, filterBlocksByDensity, type AgentQuestion } from './blocks';

// Renders the structured blocks parsed from an assistant message.

function ActionLog({ data }: { data: Record<string, unknown> }) {
  const status = String(data.status ?? 'complete');
  const output = String(data.output ?? '');
  return (
    <div className={cn(
      'rounded-md border text-xs overflow-hidden',
      status === 'error' ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-muted/20',
    )}>
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/50">
        <span className={cn('w-1.5 h-1.5 rounded-full', status === 'error' ? 'bg-red-400' : 'bg-green-400')} />
        <span className="font-mono text-[11px] text-foreground">{String(data.tool)}</span>
        <span className="text-muted-foreground truncate">{String(data.description)}</span>
      </div>
      {output && (
        <pre className="px-2.5 py-1.5 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap max-h-40 overflow-auto">
          {output}
        </pre>
      )}
    </div>
  );
}

function LabeledCard({ label, tone, inner }: { label: string; tone?: string; inner: string }) {
  return (
    <div className={cn('rounded-md border border-border bg-muted/10 overflow-hidden')}>
      <div className={cn('px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border-b border-border/50', tone ?? 'text-muted-foreground')}>
        {label}
      </div>
      <pre className="px-2.5 py-1.5 text-[11px] font-mono text-foreground/90 whitespace-pre-wrap max-h-64 overflow-auto">
        {inner}
      </pre>
    </div>
  );
}

function CodeBlock({ inner }: { inner: string }) {
  return (
    <pre className="rounded-md border border-border bg-[#0a0a0a] text-[#e4e4e7] px-2.5 py-2 text-[11px] font-mono whitespace-pre overflow-auto max-h-80">
      {inner}
    </pre>
  );
}

// ─── Interactive multiple-choice Q&A ────────────────────────────────────────
// Blocks the turn until every question is answered, then threads the answers
// back to the agent as a follow-up user message. Supports single- and
// multi-select and renders all questions in the block simultaneously.

function QuestionsBlock({
  questions, interactive, onSubmit,
}: {
  questions: AgentQuestion[];
  interactive: boolean;
  onSubmit?: (text: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);

  const toggle = (q: AgentQuestion, choiceId: string) => {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.multi) {
        return { ...prev, [q.id]: cur.includes(choiceId) ? cur.filter((c) => c !== choiceId) : [...cur, choiceId] };
      }
      return { ...prev, [q.id]: [choiceId] };
    });
  };

  const allAnswered = questions.every((q) => (answers[q.id]?.length ?? 0) > 0);

  const submit = () => {
    if (!allAnswered || !onSubmit) return;
    const lines = questions.map((q) => {
      const picked = (answers[q.id] ?? [])
        .map((cid) => q.choices.find((c) => c.id === cid)?.label ?? cid)
        .join(', ');
      return `- ${q.text} → ${picked}`;
    });
    setSubmitted(true);
    onSubmit(`Answers to your questions:\n${lines.join('\n')}`);
  };

  const locked = submitted || !interactive;

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 overflow-hidden">
      <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary border-b border-primary/20">
        {submitted ? 'Answered' : 'The agent needs your input'}
      </div>
      <div className="p-2.5 space-y-3">
        {questions.map((q) => (
          <div key={q.id} className="space-y-1.5">
            <p className="text-xs font-medium text-foreground/90">
              {q.text}{q.multi && <span className="text-[10px] text-muted-foreground/60 ml-1">(select all that apply)</span>}
            </p>
            <div className="flex flex-col gap-1">
              {q.choices.map((c) => {
                const chosen = (answers[q.id] ?? []).includes(c.id);
                return (
                  <button
                    key={c.id}
                    disabled={locked}
                    onClick={() => toggle(q, c.id)}
                    className={cn(
                      'flex items-start gap-2 w-full text-left px-2.5 py-1.5 rounded border text-xs transition-colors disabled:opacity-70 disabled:cursor-default',
                      chosen
                        ? 'border-primary/50 bg-primary/10 text-foreground'
                        : 'border-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-border/80',
                    )}
                  >
                    <span className={cn('mt-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-sm border flex-shrink-0',
                      chosen ? 'bg-primary border-primary text-primary-foreground' : 'border-border')}>
                      {chosen && <Check className="w-2.5 h-2.5" />}
                    </span>
                    <span className="flex flex-col min-w-0">
                      <span className="font-medium">{c.label}</span>
                      {c.description && <span className="text-[10px] text-muted-foreground/70">{c.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!submitted && interactive && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-muted-foreground/60">
              {allAnswered ? 'Ready to send' : 'Answer every question to continue'}
            </span>
            <Button size="xs" onClick={submit} disabled={!allAnswered}>Submit answers</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function BlockView({ block, interactive, onSubmitAnswers }: {
  block: AgentBlock;
  interactive: boolean;
  onSubmitAnswers?: (text: string) => void;
}) {
  const inner = String(block.data?.inner ?? '');

  switch (block.type) {
    case 'text':
      return <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{block.raw}</p>;
    case 'action_log':
      return <ActionLog data={block.data ?? {}} />;
    case 'questions_for_user':
      return <QuestionsBlock questions={parseQuestions(inner)} interactive={interactive} onSubmit={onSubmitAnswers} />;
    case 'plan':
      return <LabeledCard label="Plan" tone="text-primary" inner={inner} />;
    case 'agent_status':
      return <LabeledCard label="Status" inner={inner} />;
    case 'session_state_change':
      return <LabeledCard label="State change" inner={block.raw} />;
    case 'context_warning':
      return <LabeledCard label="Context warning" tone="text-amber-500" inner={inner} />;
    case 'security_review':
      return <LabeledCard label="Security review" tone="text-red-400" inner={inner} />;
    case 'change_explanation':
      return <LabeledCard label="What changed" tone="text-green-500" inner={inner} />;
    case 'file_changes':
    case 'editor_sync':
    case 'branch_visualizer_refresh':
    case 'nvim_command':
      return <LabeledCard label={block.type.replace(/_/g, ' ')} inner={inner} />;
    case 'code_file':
    case 'code_diff':
      return <CodeBlock inner={inner} />;
    default:
      return <LabeledCard label={block.type} inner={inner || block.raw} />;
  }
}

export default function AgentBlocks({
  blocks, density = 'verbose', interactive = false, onSubmitAnswers,
}: {
  blocks: AgentBlock[];
  density?: LogDensity;
  /** When true, an unanswered Q&A block is actionable (latest turn only). */
  interactive?: boolean;
  onSubmitAnswers?: (text: string) => void;
}) {
  const shown = filterBlocksByDensity(blocks, density);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {shown.map((b, i) => (
        <BlockView key={i} block={b} interactive={interactive} onSubmitAnswers={onSubmitAnswers} />
      ))}
    </div>
  );
}
