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
import { parseAgentBlocks, composeStreamingBlocks } from '@/components/agent/blocks';
import { truncateForModel, isRetryableError, isAbortError } from './agentUtils';
import { BASE_SYSTEM_PROMPT, renderSessionContext, type ModelIdentity } from './systemPrompt';
import { buildAppendPrompt } from './providers/claude_code';
import { findProvider } from './providers';
import {
  TOOLS, checkPinnedRules, executeTool, describeTool, toolCategory, type ToolCategory,
} from './tools';
import type {
  AgentRequest, AgentTransport, NeutralContent, NeutralMessage, NeutralResponse,
  NeutralUsage, StreamCallbacks,
} from './transport';

const MAX_ITERATIONS = 12;

// Transient-error retry policy for the model call. Only 429/5xx and network
// blips are retried; AbortError (Stop button) is never retried.
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 600;

/** Sleep that rejects immediately with an AbortError if the signal fires. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function createMessageWithRetry(
  transport: AgentTransport,
  req: AgentRequest,
  cbs: StreamCallbacks,
  signal?: AbortSignal,
): Promise<NeutralResponse> {
  let attempt = 0;
  for (;;) {
    try {
      return await transport.createMessage(req, cbs);
    } catch (e) {
      if (attempt >= MAX_RETRIES || !isRetryableError(e)) throw e;
      // Exponential backoff with jitter; abortable so Stop still fires promptly.
      const delay = RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250);
      await abortableDelay(delay, signal);
      attempt += 1;
    }
  }
}

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
  /** Abort signal wired to the composer's Stop button. Aborts the current
   *  transport call and breaks the tool loop cleanly. */
  signal?: AbortSignal;
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

/** Run one user turn to completion (streaming + tool loop).
 *
 *  `opts.display === false` runs the turn WITHOUT adding a visible user bubble —
 *  used for silent resumes (e.g. after CLI-approval bypass): the driver text
 *  still reaches the model via `apiMessages`, but the chat doesn't gain a
 *  duplicate "user" message. */
export async function runAgentTurn(
  session: Session,
  userText: string,
  deps: AgentLoopDeps,
  ts: string,
  opts?: { display?: boolean },
): Promise<void> {
  const { transport, dispatch, requestApproval } = deps;
  const sessionId = session.id;
  const ctx = session.context;
  const root = session.cwd ?? '.';

  // Record the user's message for display (skipped on silent resumes).
  if (opts?.display !== false) {
    dispatch({
      type: 'ADD_AGENT_MESSAGE',
      sessionId,
      message: { id: nextId('msg'), role: 'user', text: userText, blocks: [], ts },
    });
  }
  dispatch({ type: 'SET_SESSION_STATUS', sessionId, status: 'working' });

  // Build the API conversation from prior display messages, then the new turn.
  // For API providers we prepend a `<session_context>` block so the model sees
  // access level, skills, git state, etc. as a mid-conversation system message
  // (Anthropic mid-conversation system feature).
  //
  // The Claude Code CLI reads that same block as a prompt-injection attempt and
  // ignores the turn's real content, so we skip it there entirely — the CLI
  // already receives the equivalent guidance (skills + supervised clause)
  // through the sanctioned `--append-system-prompt` channel (see
  // `buildAppendPrompt` in providers/claude_code.ts).
  const apiMessages: NeutralMessage[] = session.messages
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.role, content: [{ type: 'text', text: m.text }] }));
  const skipSessionContext = transport.id === 'claude_code';
  // Resolve the real serving identity so the injected <session_context> tells
  // the model what it actually is (Gemini identifies as Gemini, etc.).
  const prov = findProvider(transport.id);
  const identity: ModelIdentity = {
    providerId: transport.id,
    providerLabel: prov?.label ?? transport.id,
    modelId: transport.modelId,
    modelLabel: prov?.models().find((m) => m.id === transport.modelId)?.label ?? transport.modelId,
  };
  apiMessages.push({
    role: 'user',
    content: [{
      type: 'text',
      text: skipSessionContext ? userText : `${renderSessionContext(session, identity)}\n\n---\n\n${userText}`,
    }],
  });

  // Track the currently-streaming assistant message across iterations so an
  // abort handler in the outer catch can finalize it (streaming: false) with
  // whatever content already arrived — including any `cli_approval_needed`
  // card the provider emitted just before the Stop-triggered reject.
  let currentAsstId: string | null = null;
  let currentBlocks: () => Array<{ type: string; raw: string; data?: Record<string, unknown> }> = () => [];
  let currentAcc = () => '';
  // Cancels any pending throttled stream flush for the current iteration so the
  // abort handler in the outer catch can finalize without a late patch racing
  // it. Reassigned each iteration.
  let cancelStreamFlush = () => {};

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const asstId = nextId('msg');
      currentAsstId = asstId;
      // Real wall-clock start for this message so the footer can show how long
      // it took (the display `ts` is the shared turn-start timestamp).
      const startedAt = Date.now();
      dispatch({
        type: 'ADD_AGENT_MESSAGE',
        sessionId,
        message: { id: asstId, role: 'assistant', text: '', blocks: [], streaming: true, ts: nowIso(ts) },
      });

      let acc = '';
      let thinkingAcc = '';
      currentAcc = () => acc;
      // Compose the settled block list from the current stream state. Extended-
      // thinking deltas (a separate stream, not in `acc`) are surfaced as a
      // synthetic `thinking` block prepended to the tolerant parse of the prose.
      // Called ONCE at finalize (and by the abort handler) — never per token, so
      // the streaming hot path never re-parses the whole message.
      const composeBlocks = () => composeStreamingBlocks(acc, thinkingAcc);
      currentBlocks = composeBlocks;

      // ── Streaming coalescer ────────────────────────────────────────────────
      // Tokens arrive dozens of times per second. Dispatching each one re-renders
      // the whole app. Instead we mark the stream dirty and flush at most once
      // per ~frame (trailing edge), patching only `text`/`thinking` — the block
      // parse is deferred to finalize + the render layer. A time-based timer is
      // used (not rAF) so it still flushes when the window is backgrounded.
      const FLUSH_MS = 33;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let dirty = false;
      const flush = () => {
        flushTimer = null;
        if (!dirty) return;
        dirty = false;
        dispatch({
          type: 'UPDATE_AGENT_MESSAGE',
          sessionId,
          messageId: asstId,
          patch: { text: acc, thinking: thinkingAcc },
        });
      };
      const scheduleFlush = () => {
        dirty = true;
        if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_MS);
      };
      cancelStreamFlush = () => {
        if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
        dirty = false;
      };

      // Claude Code permission mode. Precedence:
      //  1. planning build mode → `plan`: the CLI runs read-only and must end
      //     with a plan instead of editing — the hard gate that stops planning
      //     turns from touching files before the user approves.
      //  2. user-approved session bypass OR full-access → `bypassPermissions`.
      //  3. otherwise `acceptEdits` (auto-approve edits, prompt for the rest —
      //     surfaces as `cli_approval_needed`).
      // Bypass wins over planning only once approval has flipped the mode to
      // `direct` (see `approvePlan` in ChatPanel), so an approved implementation
      // turn is never gated.
      const permissionMode = ctx.buildMode === 'planning'
        ? 'plan'
        : (ctx.cliBypass || ctx.accessLevel === 'full_access')
          ? 'bypassPermissions'
          : 'acceptEdits';

      const req: AgentRequest = {
        system: BASE_SYSTEM_PROMPT,
        messages: apiMessages,
        tools: TOOLS,
        maxTokens: 64000,
        effort: ctx.reasoningBudget,
        thinking: ctx.deepThinking || ctx.reasoningBudget !== 'low',
        cwd: session.cwd,
        signal: deps.signal,
        permissionMode,
        // Skill-aware append prompt reaches the Claude Code CLI via the
        // sanctioned `--append-system-prompt` channel so enabled skill flags
        // (minimal_diff, test_first, etc.) actually shape the CLI's behavior.
        // Non-CLI providers ignore this field.
        appendSystem: buildAppendPrompt(ctx.skills, ctx.accessLevel, ctx.buildMode),
      };

      const final = await createMessageWithRetry(transport, req, {
        onText: (delta) => {
          acc += delta;
          scheduleFlush();
        },
        onThinking: (delta) => {
          thinkingAcc += delta;
          scheduleFlush();
        },
      }, deps.signal);

      // Drop any pending throttled flush; the finalize dispatch below carries
      // the freshest text plus the one-time block parse.
      cancelStreamFlush();
      dispatch({
        type: 'UPDATE_AGENT_MESSAGE',
        sessionId,
        messageId: asstId,
        patch: {
          text: acc, thinking: thinkingAcc, blocks: composeBlocks(), streaming: false,
          endTs: new Date().toISOString(), durationMs: Date.now() - startedAt,
        },
      });
      dispatch({ type: 'UPDATE_CONTEXT_TOKENS', sessionId, used: totalTokens(final.usage) });

      // Record the model the provider actually served (vs the one requested) so
      // the picker chip can show what really ran — keyed by provider:model.
      if (final.providerModel) {
        dispatch({ type: 'SET_SERVED_MODEL', key: `${transport.id}:${transport.modelId}`, model: final.providerModel });
      }

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

        results.push({ type: 'tool_result', toolUseId: tu.id, content: truncateForModel(content), isError });

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

      // Break the tool loop cleanly if the user hit Stop between iterations.
      if (deps.signal?.aborted) break;
    }

    dispatch({ type: 'SET_SESSION_STATUS', sessionId, status: 'complete' });
  } catch (e) {
    // Stop button: caller aborted mid-stream. Treat as a clean end, not error.
    const aborted = deps.signal?.aborted || isAbortError(e);
    if (aborted) {
      // Finalize the currently-streaming assistant message with whatever
      // content already arrived (including a cli_approval_needed card the
      // provider emitted just before rejecting). We APPEND the "Stopped by
      // user" notice to the same message rather than adding a new one so
      // that the approval card remains part of the latest turn — otherwise
      // `interactive` would flip to false and its Approve/Deny buttons
      // wouldn't render.
      cancelStreamFlush();
      if (currentAsstId) {
        const finalBlocks = [...currentBlocks(), { type: 'text', raw: '⚠ Stopped by user.' }];
        dispatch({
          type: 'UPDATE_AGENT_MESSAGE',
          sessionId,
          messageId: currentAsstId,
          patch: { text: currentAcc(), blocks: finalBlocks, streaming: false },
        });
      } else {
        dispatch({
          type: 'ADD_AGENT_MESSAGE',
          sessionId,
          message: {
            id: nextId('msg'),
            role: 'assistant',
            text: '',
            blocks: [{ type: 'text', raw: '⚠ Stopped by user.' }],
            ts: nowIso(ts),
          },
        });
      }
      dispatch({ type: 'SET_SESSION_STATUS', sessionId, status: 'complete' });
      return;
    }
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
