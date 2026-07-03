import { memo, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, Brain, MessagesSquare, ShieldAlert, Copy,
  Sparkles, FileEdit, FilePlus, FileMinus, FileText as FileTextIcon,
  Bug, ShieldCheck, ClipboardList, Wrench, CornerDownRight,
  AlertTriangle, FileCode, GitCompareArrows, RotateCcw, Search, SquareTerminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from '@/services/toast';
import type { AgentBlock } from '@/types/session';
import type { LogDensity } from '@/types';
import {
  parseQuestions, filterBlocksByDensity, extractAttr,
  type TaskSummaryFile, type AgentQuestion, type PlanStep, type StatusFile, type StatusCommand,
} from './blocks';
import Markdown from './Markdown';
import StreamingText from './StreamingText';
import CodeFrame from './CodeFrame';
import ToolRow from './ToolRow';

// ─── Block renderers ─────────────────────────────────────────────────────────
// One component per structured block the agent emits. They share a visual
// language: rounded-lg cards, a status dot / tinted accent, a compact header
// row, and a scroll-capped body. `BlockView` (below) maps a block type → the
// right renderer; unknown types fall back to a generic LabeledCard.

// A single CLI/tool step (read / grep / edit / run …). The most frequent card,
// so it stays compact and log-like.
function ActionLog({ data }: { data: Record<string, unknown> }) {
  const status = String(data.status ?? 'complete');
  const isErr = status === 'error';
  const output = String(data.output ?? '');
  return (
    <div className={cn(
      'rounded-lg border text-xs overflow-hidden',
      isErr ? 'border-red-500/30 bg-red-500/5' : 'border-border/60 bg-muted/15',
    )}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', isErr ? 'bg-red-400' : 'bg-emerald-400')} />
        <span className="font-mono text-[11px] font-medium text-foreground/90 flex-shrink-0">{String(data.tool)}</span>
        <span className="text-muted-foreground truncate">{String(data.description)}</span>
      </div>
      {output && (
        <pre className="px-3 py-1.5 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap max-h-40 overflow-auto border-t border-border/40 bg-background/30">
          {output}
        </pre>
      )}
    </div>
  );
}

// Generic titled card for the assorted status blocks (agent_status, security
// review, change explanation, …). `tone` colours the header label.
function LabeledCard({ label, tone, inner }: { label: string; tone?: string; inner: string }) {
  // Empty self-closing signal (e.g. `<editor_sync/>`) — nothing to show.
  if (!inner.trim()) return null;
  return (
    <div className={cn('rounded-lg border border-border/60 bg-muted/10 overflow-hidden')}>
      <div className={cn('px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b border-border/40', tone ?? 'text-muted-foreground')}>
        {label}
      </div>
      <pre className="px-3 py-2 text-[11px] font-mono text-foreground/90 whitespace-pre-wrap max-h-64 overflow-auto">
        {inner}
      </pre>
    </div>
  );
}

// ─── Collapsible "Thinking…" card ────────────────────────────────────────────
// Surfaces the model's reasoning. Collapsed by default with a one-line preview
// (live tail while streaming, opening line once settled) so the closed card
// still tells you what the model is working through.

function ThinkingCard({ inner, streaming }: { inner: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const lines = inner.trim().split('\n').filter((l) => l.trim());
  const preview = (streaming ? lines[lines.length - 1] : lines[0]) ?? '';
  return (
    <div className="rounded-lg border border-violet-500/25 bg-violet-500/5 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left hover:bg-muted/20 transition-colors"
      >
        <Brain className={cn('w-3 h-3 flex-shrink-0 text-muted-foreground', streaming && 'animate-pulse text-primary')} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-shrink-0">
          {streaming ? 'Thinking…' : 'Thought process'}
        </span>
        {!open && preview && (
          <span className="text-[10px] italic text-muted-foreground/50 truncate min-w-0">{preview}</span>
        )}
        <ChevronDown className={cn('w-3 h-3 ml-auto flex-shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <pre className="px-2.5 py-1.5 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap max-h-64 overflow-auto border-t border-border/50">
              {inner}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
function QuestionsBlock({
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

// ─── CLI approval card ──────────────────────────────────────────────────────
// Surfaced when the Claude Code CLI failed one or more tool calls with
// "requires approval". Approve grants session-scoped bypass permissions and
// auto-resubmits the last user prompt so the work resumes.

function CliApprovalCard({
  data, interactive, planningHint, onApprove,
}: {
  data: Record<string, unknown>;
  interactive: boolean;
  /** Extra footer line ("Approving will let the CLI finish writing your plan
   *  file") shown when we know the current session is in planning mode. */
  planningHint?: string;
  onApprove?: () => void;
}) {
  const [decided, setDecided] = useState<'approved' | 'denied' | null>(null);
  const reason = String(data.reason ?? 'The agent needs permission to run commands.');
  // Rows are `{ label, full }` — see hydrateApprovalCard in blocks.ts. Legacy
  // blobs (plain string[]) still render by upgrading each to `{ label, full }`.
  const rows: Array<{ label: string; full: string }> = Array.isArray(data.commands)
    ? (data.commands as unknown[]).map((c) =>
      typeof c === 'string' ? { label: c, full: c } : (c as { label: string; full: string }))
    : [];
  // Distinct source compounds — one per tool_use — for the "Copy compound"
  // affordance, so the user can grab exactly what the CLI tried to run.
  const distinctCompounds = Array.from(new Set(rows.map((r) => r.full)));
  const copyAll = async () => {
    if (distinctCompounds.length === 0) return;
    try {
      await navigator.clipboard.writeText(distinctCompounds.join('\n'));
      toast.success(distinctCompounds.length > 1 ? 'Copied compound commands' : 'Copied full command');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20">
        <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-foreground">
          {decided === 'approved' ? 'Approved · resuming' : decided === 'denied' ? 'Denied' : 'Approval needed'}
        </span>
        {distinctCompounds.length > 0 && (
          <button
            onClick={copyAll}
            title={distinctCompounds.join('\n')}
            className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Copy className="w-3 h-3" /> Copy {distinctCompounds.length > 1 ? 'compounds' : 'full'}
          </button>
        )}
      </div>
      <div className="p-3 space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed">{reason}</p>
        {rows.length > 0 && (
          <ul className="rounded border border-border/60 bg-background/60 px-2.5 py-1.5 space-y-0.5">
            {rows.map((r, i) => (
              <li
                key={i}
                title={r.full !== r.label ? `Part of: ${r.full}` : undefined}
                className="text-[11px] font-mono text-foreground/90 truncate"
              >
                <span className="text-muted-foreground/60 mr-1.5">$</span>{r.label}
              </li>
            ))}
          </ul>
        )}
        {decided === null && interactive && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-muted-foreground/60">
              Grants bypass for this session only. You can revoke by resetting the thread.
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="xs" variant="outline" onClick={() => setDecided('denied')}>Deny</Button>
              <Button
                size="xs"
                onClick={() => { setDecided('approved'); onApprove?.(); }}
              >
                Approve for session
              </Button>
            </div>
          </div>
        )}
        {planningHint && (
          <p className="text-[10px] text-muted-foreground/70 italic pt-0.5">{planningHint}</p>
        )}
      </div>
    </div>
  );
}

// ─── Pending-action approval card ────────────────────────────────────────────
// A supervised-mode API model proposes an action as a <pending_action> block and
// pauses. This renders it as an interactive card; approving/rejecting continues
// the turn via a follow-up prompt (wired in ChatPanel). Only the latest, settled
// assistant message gets live buttons (`interactive`).
function PendingActionBlockCard({
  data, interactive, onDecision,
}: {
  data: Record<string, unknown>;
  interactive: boolean;
  onDecision?: (decision: 'approve' | 'reject') => void;
}) {
  const [decided, setDecided] = useState<'approve' | 'reject' | null>(null);
  const actionType = String(data.actionType ?? 'action').replace(/_/g, ' ');
  const description = String(data.description ?? '');
  const command = String(data.command ?? '');
  const files = String(data.filesAffected ?? '');
  const risk = String(data.risk ?? 'low');
  const reason = String(data.reason ?? '');
  const riskTone = risk === 'high' ? 'text-red-400 border-red-400/40 bg-red-400/10'
    : risk === 'medium' ? 'text-amber-400 border-amber-400/40 bg-amber-400/10'
      : 'text-green-400 border-green-400/40 bg-green-400/10';

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/20">
        <ShieldAlert className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="text-xs font-semibold text-foreground">
          {decided === 'approve' ? 'Approved · continuing' : decided === 'reject' ? 'Rejected' : 'Approval needed'}
        </span>
        <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60">{actionType}</span>
        <span className={cn('ml-auto px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider', riskTone)}>
          {risk} risk
        </span>
      </div>
      <div className="p-3 space-y-2">
        {description && <p className="text-xs text-foreground/90 leading-relaxed">{description}</p>}
        {command && (
          <pre className="text-[11px] font-mono bg-background/60 rounded border border-border px-2.5 py-1.5 overflow-auto">
            <span className="text-muted-foreground/50 mr-1.5">$</span>{command}
          </pre>
        )}
        {files && (
          <p className="text-[10px] text-muted-foreground/70">
            <span className="uppercase tracking-wider mr-1.5 text-muted-foreground/50">files</span>
            <span className="font-mono text-foreground/80">{files}</span>
          </p>
        )}
        {reason && <p className="text-[11px] text-muted-foreground/70 italic leading-relaxed">{reason}</p>}
        {decided === null && interactive && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button size="xs" variant="outline" onClick={() => { setDecided('reject'); onDecision?.('reject'); }}>
              Reject
            </Button>
            <Button size="xs" onClick={() => { setDecided('approve'); onDecision?.('approve'); }}>
              Approve &amp; continue
            </Button>
          </div>
        )}
        {decided === null && !interactive && (
          <p className="text-[10px] text-muted-foreground/40 pt-0.5">Approve on the latest turn to continue.</p>
        )}
      </div>
    </div>
  );
}

// ─── Task summary card ──────────────────────────────────────────────────────
// Structured wrap-up the model emits at the end of non-trivial turns. Renders
// as a distinct footer card with sectioned headings so a reviewer can scan
// what was done without re-reading the whole transcript.

const FILE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  added: FilePlus,
  modified: FileEdit,
  deleted: FileMinus,
};
const FILE_CHIP: Record<string, string> = {
  added: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  modified: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  deleted: 'text-red-400 bg-red-500/10 border-red-500/25',
};

function TaskSummaryCard({ data }: { data: Record<string, unknown> }) {
  const whatWasDone = String(data.whatWasDone ?? '');
  const rootCause = String(data.rootCause ?? '');
  const features = String(data.features ?? '');
  const notes = String(data.notes ?? '');
  const files = (Array.isArray(data.files) ? data.files : []) as TaskSummaryFile[];
  const commands = (Array.isArray(data.commands) ? data.commands : []) as string[];

  const [showAllFiles, setShowAllFiles] = useState(false);
  const shownFiles = showAllFiles ? files : files.slice(0, 10);

  const copyAll = async () => {
    if (!commands.length) return;
    try {
      await navigator.clipboard.writeText(commands.join('\n'));
      toast.success('Copied verification commands');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/20">
        <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="text-xs font-semibold text-foreground">Task summary</span>
      </div>
      <div className="p-3 space-y-3">
        {whatWasDone && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">What was done</p>
            <Markdown text={whatWasDone} />
          </div>
        )}

        {files.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Files</p>
            <ul className="rounded border border-border/60 bg-background/40 divide-y divide-border/40">
              {shownFiles.map((f, i) => {
                const Icon = FILE_ICON[f.change] || FileTextIcon;
                const chip = FILE_CHIP[f.change] || 'text-muted-foreground bg-muted/30 border-border';
                return (
                  <li key={i} className="flex items-start gap-2 px-2.5 py-1.5 text-xs">
                    <Icon className="w-3 h-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span className="font-mono text-foreground/90 truncate flex-shrink min-w-0">{f.path}</span>
                    <span className={cn(
                      'px-1.5 py-[1px] rounded text-[10px] font-medium leading-none border flex-shrink-0',
                      chip,
                    )}>
                      {f.change}
                    </span>
                    {f.description && (
                      <span className="text-muted-foreground truncate flex-1 min-w-0">— {f.description}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {files.length > 10 && !showAllFiles && (
              <button
                onClick={() => setShowAllFiles(true)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                +{files.length - 10} more…
              </button>
            )}
          </div>
        )}

        {rootCause && (
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">
              <Bug className="w-3 h-3" /> Root cause
            </p>
            <Markdown text={rootCause} />
          </div>
        )}

        {features && (
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="w-3 h-3" /> Features
            </p>
            <Markdown text={features} />
          </div>
        )}

        {commands.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                <ShieldCheck className="w-3 h-3" /> Verification
              </p>
              <button
                onClick={copyAll}
                title="Copy all commands"
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Copy className="w-3 h-3" /> Copy all
              </button>
            </div>
            <ul className="rounded border border-border/60 bg-background/40 divide-y divide-border/40">
              {commands.map((c, i) => (
                <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono">
                  <span className="text-muted-foreground/60">$</span>
                  <span className="text-foreground/90 truncate flex-1">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {notes && (
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <ClipboardList className="w-3 h-3" /> Notes
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Plan card ───────────────────────────────────────────────────────────────

const COMPLEXITY_TONE: Record<string, string> = {
  low: 'text-green-400', medium: 'text-yellow-400', high: 'text-red-400', complex: 'text-red-400',
};
const STEP_STATUS_TONE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground', in_progress: 'bg-primary/15 text-primary',
  complete: 'bg-green-500/15 text-green-400', blocked: 'bg-red-500/15 text-red-400',
};

function PlanCard({ data }: { data: Record<string, unknown> }) {
  const title = String(data.planTitle ?? '');
  const objective = String(data.objective ?? '');
  const inScope = String(data.inScope ?? '');
  const outOfScope = String(data.outOfScope ?? '');
  const complexity = String(data.complexity ?? '');
  const steps = (data.steps as PlanStep[] | undefined) ?? [];

  // Long plans dominate the transcript — collapse them by default with a
  // one-line summary; short plans stay open so nothing hides.
  const [open, setOpen] = useState(() => steps.length <= 6);

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-2.5 py-1 border-b border-primary/20 text-left hover:bg-primary/10 transition-colors"
        aria-expanded={open}
      >
        <ClipboardList className="w-3 h-3 text-primary flex-shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-primary flex-shrink-0">Plan</span>
        {!open && title && (
          <span className="text-[11px] text-foreground/80 truncate min-w-0">{title}</span>
        )}
        {!open && steps.length > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground/70 flex-shrink-0">
            · {steps.length} step{steps.length === 1 ? '' : 's'}
          </span>
        )}
        {complexity && (
          <span className={cn('ml-auto text-[10px] font-medium flex-shrink-0', COMPLEXITY_TONE[complexity.toLowerCase()] ?? 'text-muted-foreground')}>
            {complexity}
          </span>
        )}
        <ChevronDown className={cn('w-3 h-3 flex-shrink-0 text-muted-foreground transition-transform', open ? 'rotate-180' : '', !complexity && 'ml-auto')} />
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

// ─── Status heartbeat card ───────────────────────────────────────────────────

function StatusCard({ data }: { data: Record<string, unknown> }) {
  const files = (data.files as StatusFile[] | undefined) ?? [];
  const commands = (data.commands as StatusCommand[] | undefined) ?? [];
  const messages = (data.messages as string[] | undefined) ?? [];
  const state = String(data.state ?? '');
  const currentStep = String(data.currentStep ?? '');
  // Pure-noise heartbeat (all sections empty) — render nothing.
  if (!files.length && !commands.length && !messages.length && !state && !currentStep) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border/40">
        <Wrench className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
        {state && <span className="ml-auto text-[10px] text-foreground/70">{state}{currentStep ? ` · ${currentStep}` : ''}</span>}
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] font-mono rounded bg-background/60 border border-border/40 px-1.5 py-0.5">
                {f.action && <span className="text-muted-foreground">{f.action}</span>}
                <span className="text-foreground/80 truncate max-w-[200px]" title={f.path}>{f.path}</span>
              </span>
            ))}
          </div>
        )}
        {commands.map((c, i) => <CodeFrame key={i} code={c.cmd} className="my-0.5" />)}
        {messages.map((mtext, i) => <div key={i} className="text-[11px] text-foreground/80 leading-relaxed">{mtext}</div>)}
      </div>
    </div>
  );
}

// ─── Session-state-change chip ───────────────────────────────────────────────

function StateChangeChip({ data }: { data: Record<string, unknown> }) {
  const to = String(data.to ?? '');
  const reason = String(data.reason ?? '');
  if (!to) return null;
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-0.5" title={reason}>
      <CornerDownRight className="w-3 h-3 flex-shrink-0" />
      <span>state → <span className="font-medium text-foreground/80">{to.replace(/_/g, ' ')}</span></span>
      {reason && <span className="truncate opacity-70">· {reason}</span>}
    </div>
  );
}

// ─── Agent error card ────────────────────────────────────────────────────────
// Terminal failures (provider errors, tool blowups) and user stops render as a
// distinct card instead of loose warning text. Retry — latest turn only —
// replays the last user message.

function AgentErrorCard({ data, interactive, onRetry }: {
  data: Record<string, unknown>;
  interactive: boolean;
  onRetry?: () => void;
}) {
  const kind = extractAttr(String(data.attrs ?? ''), 'kind') ?? 'provider';
  const message = String(data.inner ?? '').trim() || 'Something went wrong.';
  const aborted = kind === 'aborted';
  return (
    <div className={cn(
      'rounded-lg border overflow-hidden',
      aborted ? 'border-amber-500/30 bg-amber-500/5' : 'border-destructive/40 bg-destructive/5',
    )}>
      <div className="flex items-center gap-2 px-3 py-2">
        <AlertTriangle className={cn('w-4 h-4 flex-shrink-0', aborted ? 'text-amber-400' : 'text-destructive')} />
        <span className="text-xs font-semibold text-foreground">
          {aborted ? 'Stopped by user' : 'Agent error'}
        </span>
        {!aborted && interactive && onRetry && (
          <Button size="xs" variant="outline" className="ml-auto" onClick={onRetry}>
            <RotateCcw className="w-3 h-3 mr-1" /> Retry
          </Button>
        )}
      </div>
      {!aborted && (
        <p className="px-3 pb-2.5 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
          {message}
        </p>
      )}
    </div>
  );
}

// ─── Minimized backbox routing (clean density) ──────────────────────────────
// Maps an action-category block to the one-line ToolRow header, with the full
// renderer as the expandable body.

const TOOL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  grep: Search,
  read_file: FileTextIcon,
  write_file: FileEdit,
  edit_file: FileEdit,
  run_command: SquareTerminal,
};

function ToolRowBlock({ block, streaming, defaultOpen }: {
  block: AgentBlock;
  streaming?: boolean;
  defaultOpen: boolean;
}) {
  const data = block.data ?? {};
  let title = block.type.replace(/_/g, ' ');
  let subtitle = '';
  let status: 'ok' | 'error' | 'running' = 'ok';
  let Icon: React.ComponentType<{ className?: string }> = Wrench;
  let body: React.ReactNode;
  if (block.type === 'action_log') {
    const tool = String(data.tool ?? 'tool');
    const output = String(data.output ?? '');
    title = tool;
    subtitle = String(data.description ?? '');
    status = String(data.status ?? '') === 'error' ? 'error' : 'ok';
    Icon = TOOL_ICON[tool] ?? Wrench;
    // Output only — the row header already carries tool + description, so the
    // full ActionLog card would just repeat it.
    body = output
      ? (
        <pre className="px-1 py-0.5 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap max-h-40 overflow-auto">
          {output}
        </pre>
      )
      : <p className="px-1 py-0.5 text-[11px] text-muted-foreground/60 italic">No output.</p>;
  } else {
    if (block.type === 'code_file' || block.type === 'code_diff') {
      title = block.type === 'code_file' ? 'file' : 'diff';
      subtitle = extractAttr(String(data.attrs ?? ''), 'path') ?? '';
      status = streaming ? 'running' : 'ok';
      Icon = block.type === 'code_file' ? FileCode : GitCompareArrows;
    } else if (block.type === 'file_changes') {
      title = 'changes';
      Icon = FileEdit;
    }
    body = <BlockView block={block} interactive={false} streaming={streaming} />;
  }
  return (
    <ToolRow
      icon={<Icon className="w-3 h-3 flex-shrink-0 text-muted-foreground" />}
      title={title}
      subtitle={subtitle}
      status={status}
      defaultOpen={defaultOpen}
    >
      {body}
    </ToolRow>
  );
}

const BlockView = memo(function BlockView({ block, interactive, streaming, onOpenQuestions, onApproveCliBypass, onPendingAction, onRetry, cliApprovalHint }: {
  block: AgentBlock;
  interactive: boolean;
  streaming?: boolean;
  onOpenQuestions?: (questions: AgentQuestion[]) => void;
  onApproveCliBypass?: () => void;
  onPendingAction?: (decision: 'approve' | 'reject') => void;
  onRetry?: () => void;
  /** Extra hint shown on `cli_approval_needed` cards (e.g. planning mode). */
  cliApprovalHint?: string;
}) {
  const inner = String(block.data?.inner ?? '');

  switch (block.type) {
    case 'text':
      // Animate word-by-word while streaming; render lightweight markdown once
      // the message settles (so partial fences/formatting never flicker).
      return streaming
        ? <StreamingText text={block.raw} streaming />
        : <Markdown text={block.raw} />;
    case 'thinking':
      return <ThinkingCard inner={inner || block.raw} streaming={streaming} />;
    case 'action_log':
      return <ActionLog data={block.data ?? {}} />;
    case 'questions_for_user':
      return <QuestionsBlock inner={inner} interactive={interactive} onOpenQuestions={onOpenQuestions} />;
    case 'cli_approval_needed':
      return (
        <CliApprovalCard
          data={block.data ?? {}}
          interactive={interactive}
          planningHint={cliApprovalHint}
          onApprove={onApproveCliBypass}
        />
      );
    case 'pending_action':
      return (
        <PendingActionBlockCard
          data={block.data ?? {}}
          interactive={interactive}
          onDecision={onPendingAction}
        />
      );
    case 'task_summary':
      return <TaskSummaryCard data={block.data ?? {}} />;
    case 'plan':
      return <PlanCard data={block.data ?? {}} />;
    case 'agent_status':
      return <StatusCard data={block.data ?? {}} />;
    case 'session_state_change':
      return <StateChangeChip data={block.data ?? {}} />;
    case 'agent_error':
      return <AgentErrorCard data={block.data ?? {}} interactive={interactive} onRetry={onRetry} />;
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
      return <CodeFrame code={inner} />;
    default:
      return <LabeledCard label={block.type} inner={inner || block.raw} />;
  }
});

// ─── Semantic grouping ───────────────────────────────────────────────────────
// The agent emits a flat stream of blocks. To make a turn scannable we group
// consecutive blocks into semantic sections — reasoning, the actions the agent
// took (tool steps, edits), and its response prose — preserving chronological
// order. Only the "actions" run gets a labeled, collapsible wrapper (the noisy
// part); prose and reasoning render inline with a light "Response" divider so
// the reader can tell "what it did" from "what it's telling me".

type BlockCat = 'thinking' | 'action' | 'answer' | 'interactive';

const ACTION_TYPES = new Set([
  'action_log', 'file_changes', 'editor_sync', 'branch_visualizer_refresh',
  'nvim_command', 'code_file', 'code_diff',
]);
const INTERACTIVE_TYPES = new Set(['questions_for_user', 'cli_approval_needed', 'pending_action']);

function categoryOf(type: string): BlockCat {
  if (type === 'thinking') return 'thinking';
  if (ACTION_TYPES.has(type)) return 'action';
  if (INTERACTIVE_TYPES.has(type)) return 'interactive';
  return 'answer';
}

interface BlockRun { cat: BlockCat; items: { block: AgentBlock; idx: number }[] }

function groupRuns(blocks: AgentBlock[]): BlockRun[] {
  const runs: BlockRun[] = [];
  blocks.forEach((block, idx) => {
    const cat = categoryOf(block.type);
    const last = runs[runs.length - 1];
    if (last && last.cat === cat) last.items.push({ block, idx });
    else runs.push({ cat, items: [{ block, idx }] });
  });
  return runs;
}

// Collapsible cluster of tool steps / edits. Defaults open in verbose density
// and while streaming (watch the work happen); clean starts it folded — the
// quiet "backbox" — and routes each step through a minimized ToolRow. The
// default follows density/streaming until the user toggles the section.
function ActionsSection({
  run, density, interactive, streaming, onOpenQuestions, onApproveCliBypass, onPendingAction,
}: {
  run: BlockRun;
  density: LogDensity;
  interactive: boolean;
  streaming?: boolean;
  onOpenQuestions?: (questions: AgentQuestion[]) => void;
  onApproveCliBypass?: () => void;
  onPendingAction?: (decision: 'approve' | 'reject') => void;
}) {
  const defaultOpen = density === 'verbose' || !!streaming;
  const [open, setOpen] = useState(defaultOpen);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setOpen(defaultOpen);
  }, [defaultOpen]);
  const count = run.items.length;
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden">
      <button
        onClick={() => { touched.current = true; setOpen((o) => !o); }}
        className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left hover:bg-muted/25 transition-colors"
      >
        <Wrench className={cn('w-3 h-3 text-muted-foreground', streaming && 'text-primary')} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Actions
        </span>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          {count} step{count === 1 ? '' : 's'}
        </span>
        <ChevronDown className={cn('w-3 h-3 ml-auto text-muted-foreground transition-transform', open && 'rotate-180')} />
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
            <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1.5 border-t border-border/40">
              {run.items.map(({ block, idx }) => (
                density === 'clean' ? (
                  <ToolRowBlock key={`${block.type}-${idx}`} block={block} streaming={streaming} defaultOpen={false} />
                ) : (
                  <BlockView
                    key={`${block.type}-${idx}`}
                    block={block}
                    interactive={interactive}
                    streaming={streaming}
                    onOpenQuestions={onOpenQuestions}
                    onApproveCliBypass={onApproveCliBypass}
                    onPendingAction={onPendingAction}
                  />
                )
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AgentBlocks({
  blocks, density = 'verbose', interactive = false, streaming = false, onOpenQuestions, onApproveCliBypass, onPendingAction, onRetry, cliApprovalHint,
}: {
  blocks: AgentBlock[];
  density?: LogDensity;
  /** When true, an unanswered Q&A block is actionable (latest turn only). */
  interactive?: boolean;
  /** True while the parent message is still streaming (animates text). */
  streaming?: boolean;
  onOpenQuestions?: (questions: AgentQuestion[]) => void;
  onApproveCliBypass?: () => void;
  onPendingAction?: (decision: 'approve' | 'reject') => void;
  /** Replay the last user message (agent_error card, latest turn only). */
  onRetry?: () => void;
  /** Extra hint shown on the `cli_approval_needed` card. */
  cliApprovalHint?: string;
}) {
  const shown = filterBlocksByDensity(blocks, density);
  if (shown.length === 0) return null;

  const runs = groupRuns(shown);
  // Show a "Response" divider before the first prose/answer run that follows
  // reasoning or actions — the reader's cue that the agent is now explaining.
  // A matching "Reasoning" divider marks the thinking section in verbose.
  const firstAnswer = runs.findIndex((r) => r.cat === 'answer');
  const showResponseDivider = firstAnswer > 0;
  const firstThinking = runs.findIndex((r) => r.cat === 'thinking');
  const showReasoningDivider = density === 'verbose' && firstThinking >= 0 && runs.length > 1;

  return (
    <div className="flex flex-col gap-2.5">
      {runs.map((run, ri) => {
        if (run.cat === 'action') {
          // A lone tool step skips the "Actions" wrapper for a log-like rhythm:
          // clean shows it as a single minimized row, verbose as the full card.
          if (run.items.length === 1) {
            const { block, idx } = run.items[0];
            return density === 'clean' ? (
              <ToolRowBlock key={`run-${ri}-${idx}`} block={block} streaming={streaming} defaultOpen={false} />
            ) : (
              <BlockView
                key={`run-${ri}-${idx}`}
                block={block}
                interactive={interactive}
                streaming={streaming}
                onOpenQuestions={onOpenQuestions}
                onApproveCliBypass={onApproveCliBypass}
                onPendingAction={onPendingAction}
                onRetry={onRetry}
                cliApprovalHint={cliApprovalHint}
              />
            );
          }
          return (
            <ActionsSection
              key={`run-${ri}`}
              run={run}
              density={density}
              interactive={interactive}
              streaming={streaming}
              onOpenQuestions={onOpenQuestions}
              onApproveCliBypass={onApproveCliBypass}
              onPendingAction={onPendingAction}
            />
          );
        }
        return (
          <div key={`run-${ri}`} className="flex flex-col gap-2.5">
            {showReasoningDivider && ri === firstThinking && (
              <div className="flex items-center gap-2 pt-0.5 text-muted-foreground/50">
                <Brain className="w-3 h-3" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Reasoning</span>
                <span className="flex-1 h-px bg-border/50" />
              </div>
            )}
            {showResponseDivider && ri === firstAnswer && (
              <div className="flex items-center gap-2 pt-0.5 text-muted-foreground/50">
                <CornerDownRight className="w-3 h-3" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Response</span>
                <span className="flex-1 h-px bg-border/50" />
              </div>
            )}
            {run.items.map(({ block, idx }) => (
              <BlockView
                key={`${block.type}-${idx}`}
                block={block}
                interactive={interactive}
                streaming={streaming}
                onOpenQuestions={onOpenQuestions}
                onApproveCliBypass={onApproveCliBypass}
                onPendingAction={onPendingAction}
                onRetry={onRetry}
                cliApprovalHint={cliApprovalHint}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
