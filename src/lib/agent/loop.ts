// ─── Agent loop (provider-neutral) ──────────────────────────────────────────
// Manual streaming agentic loop that talks to whichever provider is currently
// selected (see `providers/`). Streams assistant text into the session, then —
// on tool_use — enforces pinned rules, gates by access level, executes approved
// tools, and ALWAYS returns a tool_result for every tool_use_id before
// continuing. Modeled as an explicit state machine so the UI never deadlocks
// and no result is ever dropped.

import type { Dispatch } from 'react';
import type { AppAction } from '@/types';
import type { AccessLevel, Session } from '@/types/session';
import { nextId } from '@/types/session';
import { parseAgentBlocks } from '@/components/agent/blocks';
import { BASE_SYSTEM_PROMPT, renderSessionContext } from './systemPrompt';
import {
  TOOLS, checkPinnedRules, executeTool, describeTool, toolCategory, type ToolCategory,
} from './tools';
import type {
  AgentRequest, AgentTransport, NeutralContent, NeutralMessage, NeutralUsage,
} from './transport';

const MAX_ITERATIONS = 12;

export interface PendingAction {
  toolUseId: string;
  toolName: string;
  category: ToolCategory;
  description: string;
  input: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
}

export interface AgentLoopDeps {
  transport: AgentTransport;
  dispatch: Dispatch<AppAction>;
  /** Ask the user to approve a gated/supervised action. Resolves true to run. */
  requestApproval: (pending: PendingAction) => Promise<boolean>;
  /** Called after file writes / commits so the caller can refresh the graph. */
  onSideEffect?: (kind: string, block: string) => void;
}

/** Which categories require approval at each access level. */
function requiresApproval(level: AccessLevel, category: ToolCategory): boolean {
  if (level === 'supervised') return true;
  if (level === 'auto_accept') return category !== 'file';
  return false; // full_access — pinned rules still enforced separately
}

function riskOf(category: ToolCategory): 'low' | 'medium' | 'high' {
  if (category === 'command') return 'high';
  if (category === 'git') return 'medium';
  return 'low';
}

function totalTokens(usage: NeutralUsage): number {
  return usage.total ?? (usage.inputTokens + usage.outputTokens);
}

function nowIso(usedTs: string): string {
  return usedTs;
}

/** Run one user turn to completion (streaming + tool loop). */
export async function runAgentTurn(
  session: Session,
  userText: string,
  deps: AgentLoopDeps,
  ts: string,
): Promise<void> {
  const { transport, dispatch, requestApproval } = deps;
  const sessionId = session.id;
  const ctx = session.context;
  const root = session.cwd ?? '.';

  // Record the user's message for display.
  dispatch({
    type: 'ADD_AGENT_MESSAGE',
    sessionId,
    message: { id: nextId('msg'), role: 'user', text: userText, blocks: [], ts },
  });
  dispatch({ type: 'SET_SESSION_STATUS', sessionId, status: 'working' });

  // Build the API conversation from prior display messages, then the new turn
  // with the volatile session context prepended (base system prompt stays cached).
  const apiMessages: NeutralMessage[] = session.messages
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.role, content: [{ type: 'text', text: m.text }] }));
  apiMessages.push({
    role: 'user',
    content: [{
      type: 'text',
      text: `${renderSessionContext(session)}\n\n---\n\n${userText}`,
    }],
  });

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const asstId = nextId('msg');
      dispatch({
        type: 'ADD_AGENT_MESSAGE',
        sessionId,
        message: { id: asstId, role: 'assistant', text: '', blocks: [], streaming: true, ts: nowIso(ts) },
      });

      let acc = '';
      const req: AgentRequest = {
        system: BASE_SYSTEM_PROMPT,
        messages: apiMessages,
        tools: TOOLS,
        maxTokens: 64000,
        effort: ctx.reasoningBudget,
        thinking: ctx.deepThinking || ctx.reasoningBudget !== 'low',
        cwd: session.cwd,
      };

      const final = await transport.createMessage(req, {
        onText: (delta) => {
          acc += delta;
          dispatch({
            type: 'UPDATE_AGENT_MESSAGE',
            sessionId,
            messageId: asstId,
            patch: { text: acc, blocks: parseAgentBlocks(acc) },
          });
        },
      });

      dispatch({
        type: 'UPDATE_AGENT_MESSAGE',
        sessionId,
        messageId: asstId,
        patch: { text: acc, blocks: parseAgentBlocks(acc), streaming: false },
      });
      dispatch({ type: 'UPDATE_CONTEXT_TOKENS', sessionId, used: totalTokens(final.usage) });

      // Side-effects declared in the text (graph refresh, editor sync, …).
      for (const b of parseAgentBlocks(acc)) {
        if (b.type === 'branch_visualizer_refresh' || b.type === 'editor_sync' || b.type === 'nvim_command') {
          deps.onSideEffect?.(b.type, b.raw);
        }
      }

      // Preserve the full assistant content (incl. tool_use) for the API.
      apiMessages.push({ role: 'assistant', content: final.content });

      if (final.stopReason === 'refusal') {
        dispatch({ type: 'SET_SESSION_STATUS', sessionId, status: 'error' });
        return;
      }
      if (final.stopReason === 'pause') {
        continue; // resume server-side tool loop
      }
      if (final.stopReason !== 'tool_use') {
        break; // end_turn / max_tokens
      }

      // ── Tool phase: enforce → gate → execute → collect ─────────────────────
      const toolUses = final.content.filter(
        (c): c is NeutralContent & { type: 'tool_use' } => c.type === 'tool_use',
      );
      const results: NeutralContent[] = [];

      for (const tu of toolUses) {
        const input = tu.input;
        const category = toolCategory(tu.name);
        let content: string;
        let isError = false;

        const pinned = checkPinnedRules(tu.name, input, ctx.pinnedRules);
        if (pinned.blocked) {
          content = `Blocked by pinned rule: "${pinned.reason}". This cannot be overridden.`;
          isError = true;
        } else {
          let approved = true;
          if (requiresApproval(ctx.accessLevel, category)) {
            dispatch({ type: 'SET_SESSION_STATUS', sessionId, status: 'awaiting_approval' });
            approved = await requestApproval({
              toolUseId: tu.id,
              toolName: tu.name,
              category,
              description: describeTool(tu.name, input),
              input,
              risk: riskOf(category),
            });
            dispatch({ type: 'SET_SESSION_STATUS', sessionId, status: 'working' });
          }
          if (!approved) {
            content = 'Denied by user.';
            isError = true;
          } else {
            try {
              content = await executeTool(tu.name, input, { root });
            } catch (e) {
              content = e instanceof Error ? e.message : String(e);
              isError = true;
            }
          }
        }

        results.push({ type: 'tool_result', toolUseId: tu.id, content, isError });

        // Render an action-log entry for this execution.
        dispatch({
          type: 'ADD_AGENT_MESSAGE',
          sessionId,
          message: {
            id: nextId('msg'),
            role: 'assistant',
            text: '',
            blocks: [{
              type: 'action_log',
              raw: '',
              data: {
                tool: tu.name,
                description: describeTool(tu.name, input),
                status: isError ? 'error' : 'complete',
                output: content.slice(0, 4000),
              },
            }],
            ts: nowIso(ts),
          },
        });
      }

      // Return ALL results in a single user message (never split, never drop).
      apiMessages.push({ role: 'user', content: results });
    }

    dispatch({ type: 'SET_SESSION_STATUS', sessionId, status: 'complete' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    dispatch({
      type: 'ADD_AGENT_MESSAGE',
      sessionId,
      message: {
        id: nextId('msg'),
        role: 'assistant',
        text: '',
        blocks: [{ type: 'text', raw: `⚠️ ${msg}` }],
        ts: nowIso(ts),
      },
    });
    dispatch({ type: 'SET_SESSION_STATUS', sessionId, status: 'error' });
  }
}
