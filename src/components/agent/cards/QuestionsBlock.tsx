import { MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseQuestions, type AgentQuestion } from '../blocks';

// ─── Interactive multiple-choice Q&A ────────────────────────────────────────
// The block itself only renders a compact placeholder in the chat — the actual
// wizard lives in <QuestionsDialog>, a portalled popup that auto-opens as soon
// as the block arrives so users don't have to scroll for it. Dismissing keeps
// the placeholder as a re-entry point; submitting threads the answers back as a
// user message (identical format to the previous inline version).

// Compact placeholder for a `<questions_for_user>` block. The actual wizard is
// a SINGLE dialog owned by ChatPanel (auto-opened once per turn), so this only
// renders the in-chat marker and an Answer button that (re)opens that dialog —
// avoids the stacked-modal bug from every block owning its own dialog.
export function QuestionsBlock({
  inner, interactive, onOpenQuestions,
}: {
  inner: string;
  interactive: boolean;
  onOpenQuestions?: (questions: AgentQuestion[]) => void;
}) {
  const questions = parseQuestions(inner);
  if (questions.length === 0) return null;
  const count = `${questions.length} question${questions.length === 1 ? '' : 's'}`;

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 flex items-center gap-3">
      <MessagesSquare className="w-4 h-4 text-primary flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">The agent needs your input</p>
        <p className="text-[11px] text-muted-foreground truncate">
          {interactive ? `${count} · click to answer` : count}
        </p>
      </div>
      {interactive && (
        <Button size="xs" onClick={() => onOpenQuestions?.(questions)}>Answer</Button>
      )}
    </div>
  );
}
