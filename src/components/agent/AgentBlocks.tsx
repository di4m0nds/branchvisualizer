import { memo, useEffect, useRef, useState } from 'react';
import FileLink from '@/components/FileLink';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, Brain, FileEdit, FileText as FileTextIcon, Wrench,
  CornerDownRight, FileCode, GitCompareArrows, Search, SquareTerminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentBlock } from '@/types/session';
import type { LogDensity } from '@/types';
import { filterBlocksByDensity, extractAttr, type AgentQuestion } from './blocks';
import ToolRow from './ToolRow';
import { getBlockRenderer, type BlockCallbacks } from './cards/registry';

// ─── Block rendering ─────────────────────────────────────────────────────────
// The card components live in ./cards/ (one file each); ./cards/registry.tsx
// declaratively maps each block type → the adapter that renders the right card
// with the right props. `BlockView` below is the lookup; unknown types fall
// back to a generic LabeledCard.

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
  let subtitle: React.ReactNode = '';
  let status: 'ok' | 'error' | 'running' = 'ok';
  let Icon: React.ComponentType<{ className?: string }> = Wrench;
  let body: React.ReactNode;
  if (block.type === 'action_log') {
    const tool = String(data.tool ?? 'tool');
    const output = String(data.output ?? '');
    title = tool;
    const desc = String(data.description ?? '');
    // Prefer the structured path (loop attaches it for file tools); fall back
    // to parsing legacy "Read src/x.ts"-style descriptions.
    const pathFromDesc = /^(Read|Write|Edit|List) (.+)$/.exec(desc)?.[2];
    const toolPath = typeof data.path === 'string' && data.path ? data.path : pathFromDesc;
    subtitle = toolPath
      ? <FileLink path={toolPath} className="text-[11px] text-muted-foreground truncate">{desc}</FileLink>
      : desc;
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
      const codePath = extractAttr(String(data.attrs ?? ''), 'path') ?? '';
      subtitle = codePath ? <FileLink path={codePath} className="text-[11px] text-muted-foreground truncate" /> : '';
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

const BlockView = memo(function BlockView({ block, interactive, streaming, ...ctx }: {
  block: AgentBlock;
  interactive: boolean;
  streaming?: boolean;
} & BlockCallbacks) {
  const Renderer = getBlockRenderer(block.type);
  return <Renderer block={block} interactive={interactive} streaming={streaming} ctx={ctx} />;
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
