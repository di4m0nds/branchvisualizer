import type { ComponentType } from 'react';
import type { AgentBlock } from '@/types/session';
import type { AgentQuestion } from '../blocks';
import Markdown from '../Markdown';
import StreamingText from '../StreamingText';
import { ActionLog } from './ActionLog';
import { LabeledCard } from './LabeledCard';
import { ThinkingCard } from './ThinkingCard';
import { QuestionsBlock } from './QuestionsBlock';
import { CliApprovalCard } from './CliApprovalCard';
import { PendingActionBlockCard } from './PendingActionBlockCard';
import { TaskSummaryCard } from './TaskSummaryCard';
import { PlanCard } from './PlanCard';
import { StatusCard } from './StatusCard';
import { StateChangeChip } from './StateChangeChip';
import { AgentErrorCard } from './AgentErrorCard';
import { TypeLabeledBlock, CodeFrameBlock, FallbackBlock } from './shared';

// ─── Block-renderer registry ─────────────────────────────────────────────────
// Declarative map from block type → the adapter that renders the right card
// with the right props. `BlockView` in AgentBlocks.tsx looks types up here;
// unknown types fall through to the generic LabeledCard fallback.

/** Callback props threaded from AgentBlocks down to individual block cards. */
export interface BlockCallbacks {
  onOpenQuestions?: (questions: AgentQuestion[]) => void;
  onApproveCliBypass?: () => void;
  onPendingAction?: (decision: 'approve' | 'reject') => void;
  onRetry?: () => void;
  /** Extra hint shown on `cli_approval_needed` cards (e.g. planning mode). */
  cliApprovalHint?: string;
}

export interface BlockRenderProps {
  block: AgentBlock;
  interactive: boolean;
  streaming?: boolean;
  ctx: BlockCallbacks;
}

const innerOf = (block: AgentBlock) => String(block.data?.inner ?? '');

/** Registry lookup: the renderer for `type`, or the unknown-type fallback. */
export function getBlockRenderer(type: string): ComponentType<BlockRenderProps> {
  return BLOCK_RENDERERS[type] ?? FallbackBlock;
}

export const BLOCK_RENDERERS: Record<string, ComponentType<BlockRenderProps>> = {
  // Animate word-by-word while streaming; render lightweight markdown once
  // the message settles (so partial fences/formatting never flicker).
  text: ({ block, streaming }) => (
    streaming
      ? <StreamingText text={block.raw} streaming />
      : <Markdown text={block.raw} />
  ),
  thinking: ({ block, streaming }) => (
    <ThinkingCard inner={innerOf(block) || block.raw} streaming={streaming} />
  ),
  action_log: ({ block }) => <ActionLog data={block.data ?? {}} />,
  questions_for_user: ({ block, interactive, ctx }) => (
    <QuestionsBlock inner={innerOf(block)} interactive={interactive} onOpenQuestions={ctx.onOpenQuestions} />
  ),
  cli_approval_needed: ({ block, interactive, ctx }) => (
    <CliApprovalCard
      data={block.data ?? {}}
      interactive={interactive}
      planningHint={ctx.cliApprovalHint}
      onApprove={ctx.onApproveCliBypass}
    />
  ),
  pending_action: ({ block, interactive, ctx }) => (
    <PendingActionBlockCard
      data={block.data ?? {}}
      interactive={interactive}
      onDecision={ctx.onPendingAction}
    />
  ),
  task_summary: ({ block }) => <TaskSummaryCard data={block.data ?? {}} />,
  plan: ({ block }) => <PlanCard data={block.data ?? {}} />,
  agent_status: ({ block }) => <StatusCard data={block.data ?? {}} />,
  session_state_change: ({ block }) => <StateChangeChip data={block.data ?? {}} />,
  agent_error: ({ block, interactive, ctx }) => (
    <AgentErrorCard data={block.data ?? {}} interactive={interactive} onRetry={ctx.onRetry} />
  ),
  context_warning: ({ block }) => (
    <LabeledCard label="Context warning" tone="text-amber-500" inner={innerOf(block)} />
  ),
  security_review: ({ block }) => (
    <LabeledCard label="Security review" tone="text-red-400" inner={innerOf(block)} />
  ),
  change_explanation: ({ block }) => (
    <LabeledCard label="What changed" tone="text-green-500" inner={innerOf(block)} />
  ),
  file_changes: TypeLabeledBlock,
  editor_sync: TypeLabeledBlock,
  branch_visualizer_refresh: TypeLabeledBlock,
  nvim_command: TypeLabeledBlock,
  code_file: CodeFrameBlock,
  code_diff: CodeFrameBlock,
};
