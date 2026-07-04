// ─── Plan / approval drivers ─────────────────────────────────────────────────
// Business logic behind ChatPanel's approval affordances, extracted as plain
// functions so the panel stays a UI component. No React in this file — every
// dependency (session, dispatch, the panel's turn runner) is an explicit
// argument, which also makes these trivial to test.

import type { AppAction } from '@/types';
import type { AgentMessage, MessageRef, Session } from '@/types/session';
import { getPrompt } from './prompts';

/** Options accepted by ChatPanel's `runTurn` (the single turn entry point). */
export interface RunTurnOptions {
  /** `false` runs the turn silently — no visible user bubble (resumes). */
  display?: boolean;
  /** Patch the session context for THIS turn only, before the store
   *  re-render from a just-dispatched change lands. */
  contextPatch?: Partial<Session['context']>;
  /** Resolved @-reference payload delivered to the model but not displayed. */
  hiddenText?: string;
  refs?: MessageRef[];
  /** Files attached from the composer (images/PDFs). */
  attachments?: AgentMessage['attachments'];
  /** Rebuild the API conversation only from messages BEFORE this id — used
   *  by Retry, whose truncate dispatch hasn't landed in `state` yet. */
  messagesUpTo?: string;
}

export type RunTurn = (text: string, opts?: RunTurnOptions) => void | Promise<void>;

type DispatchFn = (action: AppAction) => void;

/** Planning mode: approve → switch to direct execution → replay as instruction. */
export function approvePlan(sessionId: string, dispatch: DispatchFn, runTurn: RunTurn): void {
  dispatch({ type: 'SET_BUILD_MODE', sessionId, mode: 'direct' });
  runTurn(getPrompt('plan_approved'));
}

/** Approve the CLI approval card: grant session-scoped bypass, then RESUME
 *  silently. The model already has the full conversation (incl. the original
 *  request), so we drive it with a short continuation prompt and `display:
 *  false` — no duplicate user bubble; it just picks up where it stopped with
 *  full permissions. The dispatch only takes effect on the next render, so the
 *  `contextPatch` applies the bypass to THIS immediate resume too — otherwise
 *  permissionMode would still compute to `acceptEdits` and the command would
 *  need approval again. */
export function approveCliBypass(sessionId: string, dispatch: DispatchFn, runTurn: RunTurn): void {
  dispatch({ type: 'SET_SESSION_CLI_BYPASS', sessionId, bypass: true });
  runTurn(getPrompt('cli_bypass_resume'), { display: false, contextPatch: { cliBypass: true } });
}

/** Approve/reject a prose <pending_action> the model proposed in supervised
 *  mode. The turn already ended, so we continue it with a short follow-up
 *  (silent — no duplicate user bubble), mirroring the CLI-bypass resume. */
export function resumePendingAction(decision: 'approve' | 'reject', runTurn: RunTurn): void {
  if (decision === 'approve') {
    runTurn(getPrompt('action_approved'), { display: false });
  } else {
    runTurn(getPrompt('action_rejected'), { display: false });
  }
}

/** Show the plan-approval affordance when the last assistant turn produced a
 *  plan while in planning mode. */
export function planAwaitingApproval(session: Session, busy: boolean): boolean {
  const last = session.messages[session.messages.length - 1];
  return (
    session.context.buildMode === 'planning'
    && !busy
    && !!last
    && last.role === 'assistant'
    && !last.streaming
    && last.blocks.some((b) => b.type === 'plan')
  );
}

/** Planning-mode approval hint — surfaced on any `cli_approval_needed` card so
 *  users understand approving unblocks the CLI writing the plan file. */
export function cliApprovalHintFor(session: Session): string | undefined {
  return session.context.buildMode === 'planning'
    ? getPrompt('planning_hint')
    : undefined;
}
