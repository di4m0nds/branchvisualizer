// Implementation Plan review surface (right column, swapped in for the repo
// workspace). Shows the conversation's latest plan as selectable sections with
// per-section comments, supports in-place editing (persisted as a draft), and
// sends collected feedback back into the chat as a follow-up turn.

import { useMemo, useState } from 'react';
import { ClipboardList, Pencil, Send, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppDispatch } from '@/store/store';
import { nextId, type Session, type PlanComment } from '@/types/session';
import { latestPlanText, parsePlanSections } from '@/lib/agent/plan';
import { sendToChat } from '@/hooks/useSendToChat';
import { toast } from '@/services/toast';
import PlanSectionCard from './PlanSectionCard';

// Compose a revise-the-plan message from the unresolved comments, grouped by
// the section they target.
function composeFeedback(comments: PlanComment[]): string {
  const bySection = new Map<string, PlanComment[]>();
  for (const c of comments) {
    const key = c.sectionHeading || 'General';
    const list = bySection.get(key);
    if (list) list.push(c); else bySection.set(key, [c]);
  }
  const parts = ['Feedback on the implementation plan:', ''];
  for (const [heading, list] of bySection) {
    parts.push(`### ${heading}`);
    for (const c of list) parts.push(`> ${c.text.replace(/\n/g, '\n> ')}`);
    parts.push('');
  }
  parts.push('Please revise the plan accordingly.');
  return parts.join('\n');
}

export default function PlanView({ session }: { session: Session }) {
  const dispatch = useAppDispatch();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const source = latestPlanText(session);
  const draftMatches = source && session.planDraft && session.planDraft.messageId === source.messageId;
  const effectiveText = (draftMatches ? session.planDraft!.text : source?.text) ?? '';

  const sections = useMemo(
    () => parsePlanSections(effectiveText, source?.messageId ?? 'plan'),
    [effectiveText, source?.messageId],
  );

  const comments = session.planComments ?? [];
  const unresolved = comments.filter((c) => !c.resolved);

  if (!source) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-background">
        <PlanHeader disabled />
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <div className="max-w-xs space-y-2">
            <ClipboardList className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-foreground/70">No implementation plan yet.</p>
            <p className="text-xs text-muted-foreground/60">
              Switch the build mode to <span className="font-medium">Planning</span> and ask the agent to plan a task —
              its plan will appear here to review and annotate.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const messageId = source.messageId;

  function startEdit() {
    setEditValue(effectiveText);
    setEditing(true);
  }
  function saveEdit() {
    dispatch({ type: 'SET_PLAN_DRAFT', sessionId: session.id, draft: { messageId, text: editValue } });
    setEditing(false);
  }
  function addComment(section: { id: string; heading: string }, text: string) {
    const comment: PlanComment = {
      id: nextId('plancomment'),
      messageId,
      sectionId: section.id,
      sectionHeading: section.heading,
      text,
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: 'ADD_PLAN_COMMENT', sessionId: session.id, comment });
  }
  function sendFeedback() {
    if (unresolved.length === 0) return;
    const ok = sendToChat(session.id, composeFeedback(unresolved));
    if (!ok) { toast.error('Open the chat for this session first'); return; }
    for (const c of unresolved) {
      dispatch({ type: 'UPDATE_PLAN_COMMENT', sessionId: session.id, commentId: c.id, patch: { resolved: true } });
    }
    // Revise (don't execute) — put the agent back into planning.
    dispatch({ type: 'SET_BUILD_MODE', sessionId: session.id, mode: 'planning' });
    toast.success('Feedback sent to the agent');
  }
  function sendRevisedPlan() {
    if (!draftMatches) return;
    const ok = sendToChat(session.id, `Here is the revised implementation plan:\n\n${effectiveText}`);
    if (!ok) { toast.error('Open the chat for this session first'); return; }
    toast.success('Revised plan sent');
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <PlanHeader
        pending={source.pending}
        editing={editing}
        unresolvedCount={unresolved.length}
        hasDraft={!!draftMatches}
        onEdit={startEdit}
        onCancelEdit={() => setEditing(false)}
        onSaveEdit={saveEdit}
        onSendFeedback={sendFeedback}
        onSendRevised={sendRevisedPlan}
      />

      {/* One-line explainer so the actions above (Edit / Send revised / Send N)
          and per-section comment buttons below are actually discovered. */}
      {!editing && (
        <div className="flex-shrink-0 px-3 py-1.5 border-b border-border/50 bg-muted/5 text-[11px] text-muted-foreground">
          Edit the plan inline, comment on individual sections, or send feedback back to the agent.
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        {editing ? (
          <textarea
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="w-full h-full min-h-[300px] resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        ) : (
          sections.map((section) => (
            <PlanSectionCard
              key={section.id}
              section={section}
              comments={comments.filter((c) => c.sectionId === section.id)}
              selected={selectedId === section.id}
              onSelect={() => setSelectedId(section.id)}
              onAddComment={(text) => addComment(section, text)}
              onRemoveComment={(id) => dispatch({ type: 'REMOVE_PLAN_COMMENT', sessionId: session.id, commentId: id })}
              onResolveComment={(id) => {
                const c = comments.find((x) => x.id === id);
                dispatch({ type: 'UPDATE_PLAN_COMMENT', sessionId: session.id, commentId: id, patch: { resolved: !c?.resolved } });
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PlanHeader({
  pending, editing, unresolvedCount = 0, hasDraft, disabled,
  onEdit, onCancelEdit, onSaveEdit, onSendFeedback, onSendRevised,
}: {
  pending?: boolean;
  editing?: boolean;
  unresolvedCount?: number;
  hasDraft?: boolean;
  disabled?: boolean;
  onEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveEdit?: () => void;
  onSendFeedback?: () => void;
  onSendRevised?: () => void;
}) {
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 h-9 border-b border-border bg-muted/10">
      <ClipboardList className="w-3.5 h-3.5 text-primary" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/90">Implementation Plan</span>
      {pending && (
        <span className="px-1.5 py-[1px] rounded-full bg-amber-500/15 text-amber-500 text-[10px] font-medium leading-none">
          Draft
        </span>
      )}
      {!disabled && (
        <div className="ml-auto flex items-center gap-1.5">
          {editing ? (
            <>
              <Button size="xs" onClick={onSaveEdit}>
                <Check className="w-3 h-3 mr-1" /> Save
              </Button>
              <Button size="xs" variant="ghost" onClick={onCancelEdit}>
                <X className="w-3 h-3 mr-1" /> Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                size="xs"
                variant="outline"
                onClick={onEdit}
                title="Edit the plan inline"
              >
                <Pencil className="w-3 h-3 mr-1" /> Edit
              </Button>
              {hasDraft && (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={onSendRevised}
                  title="Send the edited plan to the agent"
                >
                  <Send className="w-3 h-3 mr-1" /> Send revised
                </Button>
              )}
              <Button
                size="xs"
                onClick={onSendFeedback}
                disabled={unresolvedCount === 0}
                title={unresolvedCount === 0 ? 'Add a comment to a section to send feedback' : 'Send comments to the agent as feedback'}
              >
                <Send className="w-3 h-3 mr-1" />
                Send{unresolvedCount > 0 ? ` (${unresolvedCount})` : ' feedback'}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
