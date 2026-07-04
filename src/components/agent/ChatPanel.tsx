import { memo, useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDownToLine, Check, ChevronDown, Loader2, PanelLeftClose, PanelLeftOpen, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMaximizedPanel, usePanelZoom } from '@/hooks/usePanelFocus';
import { PanelMaximizeButton } from '@/components/ide/FocusablePanel';
import { registerChatSender } from '@/hooks/useSendToChat';
import { Button } from '@/components/ui/button';
import { toast } from '@/services/toast';
import { getAppState, useAppDispatch, useAppSelector } from '@/store/store';
import { buildChatFontFamily } from '@/lib/terminalFont';
import { useRepoData } from '@/hooks/useRepoData';
import AgentBlocks from './AgentBlocks';
import AtMentionMenu from './AtMentionMenu';
import AttachedPlanStrip from './AttachedPlanStrip';
import ChatTimeline from './ChatTimeline';
import MessageActions from './MessageActions';
import QuestionsDialog from './QuestionsDialog';
import RefChips from './RefChips';
import LogDensityToggle from '@/components/ide/LogDensityToggle';
import { cachedTree, useWorkspaceTree, type TreeEntry } from '@/hooks/useWorkspaceTree';
import { fuzzyFilter } from '@/lib/fuzzy';
import {
  formatReferencedFiles, indexTree, parseRefTokens, resolveRefs, toMessageRefs,
} from '@/lib/agent/references';
import {
  deriveSteps, filterBlocksByDensity, parseQuestions, extractTag, plainTextForCopy, composeStreamingBlocks, type AgentQuestion,
} from './blocks';
import { formatTime, formatFull, formatDuration } from '@/lib/time';
import { useAgentTransport } from '@/hooks/useAgentTransport';
import {
  approvePlan as approvePlanAction,
  approveCliBypass as approveCliBypassAction,
  resumePendingAction,
  planAwaitingApproval,
  cliApprovalHintFor,
  type RunTurnOptions,
} from '@/lib/agent/planActions';
import { runAgentTurn, type PendingAction } from '@/lib/agent/loop';
import type { AgentMessage, MessageRef, Session } from '@/types/session';
import type { LogDensity } from '@/types';

// Highlight resolved @-tokens inside a sent user message. Longest tokens are
// matched first so `@src/lib` never eats the front of `@src/lib/fuzzy.ts`.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function renderUserText(text: string, refs?: MessageRef[]): React.ReactNode {
  if (!refs?.length) return text;
  const tokens = [...new Set(refs.map((r) => r.token))].sort((a, b) => b.length - a.length);
  const parts = text.split(new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'g'));
  return parts.map((part, i) =>
    tokens.includes(part)
      ? <span key={i} className="text-primary font-mono text-[13px]">{part}</span>
      : part,
  );
}

// ─── Pending-action approval card ────────────────────────────────────────────

function PendingActionCard({
  pending, onApprove, onDeny,
}: {
  pending: PendingAction;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const riskColor = pending.risk === 'high' ? 'text-red-400' : pending.risk === 'medium' ? 'text-amber-400' : 'text-green-400';
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-foreground">Approve action</span>
        <span className={cn('font-mono', riskColor)}>{pending.risk} risk</span>
      </div>
      <div className="text-xs text-muted-foreground">
        <span className="font-mono text-foreground">{pending.toolName}</span> — {pending.description}
      </div>
      {pending.toolName === 'run_command' && (
        <pre className="text-[11px] font-mono bg-background rounded border border-border px-2 py-1 overflow-auto">
          {String(pending.input.command)}
        </pre>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button size="xs" onClick={onApprove}>Approve</Button>
        <Button size="xs" variant="outline" onClick={onDeny}>Deny</Button>
      </div>
    </div>
  );
}

// ─── Message bubble ──────────────────────────────────────────────────────────

// ─── Message bubble ──────────────────────────────────────────────────────────
// One turn in the transcript. User messages sit right-aligned in a primary-tinted
// pill; assistant messages fill the width and delegate to <AgentBlocks> for their
// structured content. A hover toolbar (copy / revert) appears once settled.
// `action_log` messages (the CLI's tool steps) drop the header for a tighter,
// log-like rhythm.
const MessageView = memo(function MessageView({ msg, density, interactive, busy, animateIn, cliApprovalHint, onOpenQuestions, onRevert, onApproveCliBypass, onPendingAction, onRetry, registerRef }: {
  msg: AgentMessage;
  density: LogDensity;
  interactive: boolean;
  busy: boolean;
  /** Play the entry animation — true only on a message's first appearance. */
  animateIn: boolean;
  /** Extra footer line for `cli_approval_needed` cards (e.g. planning mode). */
  cliApprovalHint?: string;
  // Stable across renders — takes the message id so the parent doesn't need a
  // per-message closure that would defeat this component's memoization.
  onOpenQuestions: (messageId: string, questions: AgentQuestion[]) => void;
  onRevert: (msg: AgentMessage) => void;
  onApproveCliBypass: () => void;
  onPendingAction: (decision: 'approve' | 'reject') => void;
  onRetry: () => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}) {
  const isUser = msg.role === 'user';
  const isActionLog = msg.blocks.length > 0 && msg.blocks.every((b) => b.type === 'action_log');
  const showActions = !isActionLog && !msg.streaming;
  // While streaming, `blocks` is intentionally empty (the loop defers parsing);
  // derive them here, memoized on the text/thinking that actually changed. Once
  // the turn settles, use the parsed blocks the loop stored.
  const displayBlocks = useMemo(
    () => (msg.streaming ? composeStreamingBlocks(msg.text, msg.thinking) : msg.blocks),
    [msg.streaming, msg.text, msg.thinking, msg.blocks],
  );
  const handleOpenQuestions = useCallback(
    (list: AgentQuestion[]) => onOpenQuestions(msg.id, list),
    [onOpenQuestions, msg.id],
  );
  // A settled assistant turn whose every block the density filter drops (and
  // with no fallback prose) would render as a bare header + empty bubble — skip
  // it entirely. Streaming turns always render (the typing indicator is the
  // feedback that something is happening).
  const hasVisibleContent = isUser || !!msg.streaming || (
    displayBlocks.length
      ? filterBlocksByDensity(displayBlocks, density).length > 0
      : !!msg.text.trim()
  );
  if (!hasVisibleContent) return null;
  return (
    <motion.div
      id={msg.id}
      ref={(el) => registerRef(msg.id, el)}
      initial={animateIn ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={cn('group flex flex-col gap-1.5 scroll-mt-3', isUser ? 'items-end' : 'items-start')}
      // Offscreen messages skip layout/paint; the intrinsic-size hint keeps the
      // scrollbar stable. Streaming messages opt out so growth is measured live
      // (the stick-to-bottom ResizeObserver watches the content box).
      style={msg.streaming ? undefined : { contentVisibility: 'auto', containIntrinsicSize: 'auto 120px' }}
    >
      {/* Role header: dot + name + timestamp */}
      {!isActionLog && (
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/70">
          <span className={cn('w-1.5 h-1.5 rounded-full', isUser ? 'bg-primary/70' : 'bg-emerald-400/70')} />
          <span>{isUser ? 'You' : 'Agent'}</span>
          {msg.streaming && <span className="text-primary/70">· typing…</span>}
          <time dateTime={msg.ts} title={formatFull(msg.ts)} className="font-mono text-muted-foreground/40">
            {formatTime(msg.ts)}
          </time>
        </span>
      )}

      {/* Bubble */}
      <div className={cn(
        'max-w-full min-w-0 text-sm',
        isUser
          ? 'rounded-2xl rounded-tr-sm bg-primary/5 border border-primary/10 px-3.5 py-2.5'
          : isActionLog
            ? 'w-full'
            : 'w-full',
      )}>
        {isUser
          ? (
            <div className="min-w-0">
              {msg.refs && msg.refs.length > 0 && <RefChips refs={msg.refs} />}
              <p className="whitespace-pre-wrap break-words text-foreground/90 leading-relaxed">
                {renderUserText(msg.text, msg.refs)}
              </p>
            </div>
          )
          : <AgentBlocks
            blocks={displayBlocks.length ? displayBlocks : [{ type: 'text', raw: msg.text }]}
            density={density}
            interactive={interactive}
            streaming={msg.streaming}
            onOpenQuestions={handleOpenQuestions}
            onApproveCliBypass={onApproveCliBypass}
            onPendingAction={onPendingAction}
            onRetry={onRetry}
            cliApprovalHint={cliApprovalHint}
          />}
      </div>

      {/* Footer: finish time + how long this message took (assistant only). */}
      {!isUser && !isActionLog && !msg.streaming && msg.durationMs != null && (
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/40">
          <time dateTime={msg.endTs ?? msg.ts} title={formatFull(msg.endTs ?? msg.ts)}>
            {formatTime(msg.endTs ?? msg.ts)}
          </time>
          <span className="opacity-60">·</span>
          <span>{formatDuration(msg.durationMs)}</span>
        </span>
      )}

      {/* Hover toolbar */}
      {showActions && (
        <MessageActions
          text={msg.text}
          // Assistant messages copy prose only (no XML tags/logs); user
          // messages copy verbatim.
          copyText={isUser ? msg.text : plainTextForCopy(msg.text)}
          isUser={isUser}
          canRevert={!busy}
          onRevert={() => onRevert(msg)}
          align={isUser ? 'right' : 'left'}
        />
      )}
    </motion.div>
  );
});

// ─── Chat panel ──────────────────────────────────────────────────────────────

export default function ChatPanel({ session }: { session: Session }) {
  // Slice subscriptions: this panel re-renders when ITS session streams —
  // never for other sessions' churn or unrelated store changes. One-shot
  // reads inside handlers (currentModel, repoInfo) go through getAppState.
  const dispatch = useAppDispatch();
  const logDensity = useAppSelector((s) => s.logDensity);
  const chatFont = useAppSelector((s) => s.chatFont);
  const chatBackground = useAppSelector((s) => s.chatBackground);
  const { loadRepo, loadLocalRepo } = useRepoData();
  const chatFontFamily = buildChatFontFamily(chatFont);
  const chatBgClass = chatBackground === 'none' ? '' : `chat-bg-${chatBackground}`;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  // @-mention state: the token under the caret (menu open while non-null) and
  // the keyboard-active row. Number of refs currently being read before send.
  const [atToken, setAtToken] = useState<{ start: number; query: string } | null>(null);
  const [atIndex, setAtIndex] = useState(0);
  const [resolvingRefs, setResolvingRefs] = useState(0);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [activeMsgId, setActiveMsgId] = useState<string | undefined>();
  const approvalResolver = useRef<((ok: boolean) => void) | null>(null);
  // Transport creation + caching (keyed on provider/model/context-size) lives
  // in the hook; `getTransport` is identity-stable.
  const { getTransport } = useAgentTransport();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const msgRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(0);
  // "Stick to bottom": when on, the view follows new/streaming content. Scrolling
  // up turns it off (free navigation); returning to the bottom re-arms it.
  const [stick, setStick] = useState(true);
  const stickRef = useRef(stick);
  stickRef.current = stick;
  // Guards our own programmatic scrolls so onScroll doesn't misread them as the
  // user scrolling away and unstick.
  const autoScrollingRef = useRef(false);
  const chatZoom = usePanelZoom('chat');
  // When the chat is maximized, use a Claude.ai/ChatGPT-style centered column
  // with wider side padding — better line-length for reading on wide monitors.
  // Only a class swap: no layout shift on toggle.
  const maximized = useMaximizedPanel() === 'chat';
  // Single, hoisted questions popup (avoids per-block stacked modals). Auto-open
  // fires once per question message via autoOpenedRef.
  const [activeQuestions, setActiveQuestions] = useState<{ messageId: string; list: AgentQuestion[] } | null>(null);
  const autoOpenedRef = useRef<string | null>(null);

  // Always read the freshest session from state (props may be a stale snapshot).
  const live = useAppSelector((s) => s.sessions.find((x) => x.id === session.id)) ?? session;
  const turns = useMemo(() => deriveSteps(live.messages), [live.messages]);

  // ── @-mention wiring: lazy workspace tree + fuzzy matches for the menu ──
  const { entries: treeEntries, loading: treeLoading } = useWorkspaceTree(live.cwd, atToken !== null);
  const atMatches = useMemo(() => {
    if (!atToken) return [];
    const byPath = new Map(treeEntries.map((e) => [e.path, e]));
    return fuzzyFilter(atToken.query, treeEntries.map((e) => e.path), 12)
      .map((p) => byPath.get(p))
      .filter((e): e is TreeEntry => !!e);
  }, [atToken, treeEntries]);
  useEffect(() => { setAtIndex(0); }, [atToken?.query]);

  // The @-token under the caret: `@` at start-of-text or after whitespace,
  // followed only by path characters up to the caret.
  const detectAtToken = useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0) return null;
    if (at > 0 && !/\s/.test(before[at - 1])) return null;
    const query = before.slice(at + 1);
    if (!/^[A-Za-z0-9_./\\-]*$/.test(query)) return null;
    return { start: at, query };
  }, []);

  const applyAtSelection = useCallback((entry: TreeEntry) => {
    const el = composerRef.current;
    if (!el || !atToken) return;
    const caret = el.selectionStart ?? input.length;
    const insert = `@${entry.path} `;
    setInput(input.slice(0, atToken.start) + insert + input.slice(caret));
    setAtToken(null);
    const pos = atToken.start + insert.length;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  }, [atToken, input]);

  // Rotating "working…" label derived from the latest assistant message's most
  // recent block kind — gives feedback for reasoning-only turns.
  const workingLabel = useMemo(() => {
    if (!busy) return '';
    const lastAssistant = [...live.messages].reverse().find((m) => m.role === 'assistant');
    // A streaming message carries no parsed blocks yet (deferred to finalize),
    // so read its live text/thinking directly for the label.
    if (lastAssistant?.streaming) {
      return lastAssistant.thinking && !lastAssistant.text.trim() ? 'Thinking…' : 'Writing response…';
    }
    const latest = lastAssistant?.blocks[lastAssistant.blocks.length - 1];
    switch (latest?.type) {
      case 'thinking': return 'Thinking…';
      case 'action_log': {
        const tool = String(latest.data?.tool ?? '');
        if (tool === 'grep') return 'Searching files…';
        if (tool === 'read_file') return 'Reading files…';
        if (tool === 'write_file' || tool === 'edit_file') return 'Editing files…';
        if (tool === 'run_command') return 'Running command…';
        return `Running ${tool || 'tool'}…`;
      }
      case 'text': return 'Writing response…';
      default: return 'Composing response…';
    }
  }, [busy, live.messages]);

  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) msgRefs.current.set(id, el);
    else msgRefs.current.delete(id);
  }, []);

  const scrollToMessage = useCallback((id: string) => {
    setActiveMsgId(id);
    msgRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Track which message ids have already been on screen so the entry animation
  // plays only for genuinely new messages — not for a restored transcript.
  const seenIdsRef = useRef<Set<string> | null>(null);
  if (seenIdsRef.current === null) {
    seenIdsRef.current = new Set(session.messages.map((m) => m.id));
  }
  const reducedMotion = useReducedMotion();

  const revertToMessage = useCallback((msg: AgentMessage) => {
    dispatch({ type: 'TRUNCATE_MESSAGES_BEFORE', sessionId: session.id, beforeMessageId: msg.id });
    setInput(msg.text);
    setTimeout(() => {
      const el = composerRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 0);
  }, [dispatch, session.id]);

  // Approval drivers (CLI-bypass grant + silent resume, pending-action
  // approve/reject) live in planActions — these wrappers only bind the
  // session/dispatch and keep memoized identities for MessageView.
  const approveCliBypass = useCallback(() => {
    approveCliBypassAction(session.id, dispatch, runTurn);
    // runTurn declared below; TS hoisting keeps this valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, session.id]);

  const handlePendingAction = useCallback((decision: 'approve' | 'reject') => {
    resumePendingAction(decision, runTurn);
    // runTurn is a hoisted function declaration below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openQuestions = useCallback((messageId: string, list: AgentQuestion[]) => {
    setActiveQuestions({ messageId, list });
    dispatch({ type: 'SET_SESSION_STATUS', sessionId: session.id, status: 'awaiting_input' });
  }, [dispatch, session.id]);

  // Auto-open the questions popup exactly ONCE per question message. Because
  // ChatPanel is keyed by session id, switching away and back remounts it →
  // autoOpenedRef resets → one clean reopen on return.
  const lastMsg = live.messages[live.messages.length - 1];
  useEffect(() => {
    if (busy || !lastMsg || lastMsg.role !== 'assistant' || lastMsg.streaming) return;
    if (autoOpenedRef.current === lastMsg.id) return;
    const qb = lastMsg.blocks.find((b) => b.type === 'questions_for_user');
    if (!qb) return;
    const list = parseQuestions(String(qb.data?.inner ?? extractTag(qb.raw, 'questions_for_user') ?? ''));
    if (list.length === 0) return;
    autoOpenedRef.current = lastMsg.id;
    openQuestions(lastMsg.id, list);
  }, [lastMsg, busy, openQuestions]);

  // Scroll to true bottom. Targets scrollHeight AFTER the current frame so late
  // layout (markdown, code frames, expand animations) is accounted for, fixing
  // the "jump lands short" bug. Guards onScroll from unsticking mid-animation.
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    autoScrollingRef.current = true;
    const run = () => el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    run();
    requestAnimationFrame(run); // re-target once layout settles
    setUnread(0);
    window.setTimeout(() => { autoScrollingRef.current = false; }, smooth ? 420 : 80);
  }, []);

  const jumpToBottom = useCallback(() => {
    setStick(true);
    scrollToBottom(true);
  }, [scrollToBottom]);

  // Track bottom proximity. Scrolling up unsticks; returning re-arms. Ignores
  // our own programmatic scrolls (autoScrollingRef).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
      setAtBottom(nearBottom);
      if (nearBottom) setUnread(0);
      if (autoScrollingRef.current) return;
      if (!nearBottom && stickRef.current) setStick(false);
      else if (nearBottom && !stickRef.current) setStick(true);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Keep the view pinned while content grows (streaming text, expanding cards).
  // A ResizeObserver on the message content re-fires as height changes — the
  // fix for streaming not following, since message COUNT stays constant.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) scrollToBottom(false);
      else setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 24);
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  // New message: follow if stuck, else bump the unread counter.
  useEffect(() => {
    if (stickRef.current) scrollToBottom(false);
    else setUnread((n) => n + 1);
    // Only count real message changes, not ref/setState churn.
  }, [live.messages.length, scrollToBottom]);

  // Register this session's chat sender so out-of-column panels (Plan view) can
  // post follow-up messages. If busy, stage the text in the composer instead of
  // starting an overlapping turn.
  useEffect(() => {
    return registerChatSender(session.id, (text) => {
      if (busy) setInput((prev) => (prev ? `${prev}\n${text}` : text));
      else runTurn(text);
    });
    // runTurn is stable (hoisted); re-bind on busy so the guard stays current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, busy]);

  function requestApproval(p: PendingAction): Promise<boolean> {
    setPending(p);
    return new Promise<boolean>((resolve) => {
      approvalResolver.current = (ok) => {
        approvalResolver.current = null;
        setPending(null);
        resolve(ok);
      };
    });
  }

  function onSideEffect(kind: string) {
    if (kind !== 'branch_visualizer_refresh' && kind !== 'editor_sync') return;
    const repoInfo = getAppState().repoInfo;
    if (live.repoSource === 'local' && live.cwd) loadLocalRepo(live.cwd).catch(() => { });
    else if (repoInfo) loadRepo(`https://github.com/${repoInfo.fullName}`).catch(() => { });
  }

  async function runTurn(text: string, opts?: RunTurnOptions) {
    if (!text || busy) return;
    setBusy(true);
    // Fresh abort controller per turn — Stop button aborts this one.
    abortRef.current = new AbortController();
    try {
      const { providerId, modelId, context } = getAppState().currentModel;
      const transport = await getTransport(providerId, modelId, context);
      const ts = new Date().toISOString();
      // Re-read the freshest session at call time (build mode may have flipped).
      // A `contextPatch` lets a just-dispatched change (e.g. cliBypass) apply to
      // THIS turn before the store re-render lands.
      let base = getAppState().sessions.find((s) => s.id === session.id) ?? live;
      if (opts?.messagesUpTo) {
        const idx = base.messages.findIndex((m) => m.id === opts.messagesUpTo);
        if (idx >= 0) base = { ...base, messages: base.messages.slice(0, idx) };
      }
      const current = opts?.contextPatch
        ? { ...base, context: { ...base.context, ...opts.contextPatch } }
        : base;
      await runAgentTurn(current, text, {
        transport,
        dispatch,
        requestApproval,
        onSideEffect,
        signal: abortRef.current.signal,
      }, ts, { display: opts?.display, hiddenText: opts?.hiddenText, refs: opts?.refs });
    } catch (e) {
      // Aborts flow through the loop's clean-stop path; anything reaching here
      // is a real error.
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      if (!aborted) {
        toast.error('Agent error', { description: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  // Retry after an agent_error: rewind to the last user message and replay it
  // (with its attached @-references). The truncate keeps the failed turn out of
  // both the transcript and the rebuilt API conversation.
  const retryLastTurn = useCallback(() => {
    if (busy) return;
    const lastUser = [...live.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    dispatch({ type: 'TRUNCATE_MESSAGES_BEFORE', sessionId: session.id, beforeMessageId: lastUser.id });
    runTurn(lastUser.text, {
      hiddenText: lastUser.hiddenText,
      refs: lastUser.refs,
      messagesUpTo: lastUser.id,
    });
    // runTurn is a hoisted function declaration above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, live.messages, dispatch, session.id]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setAtToken(null);
    // Resolve @-references before the turn starts. Failures never block the
    // send — they surface as error chips and error attrs the model can see.
    let hiddenText: string | undefined;
    let refs: MessageRef[] | undefined;
    if (live.cwd) {
      const entries = treeEntries.length ? treeEntries : cachedTree(live.cwd);
      const parsed = parseRefTokens(text, indexTree(entries));
      if (parsed.length > 0) {
        setResolvingRefs(parsed.length);
        try {
          const resolved = await resolveRefs(live.cwd, parsed, entries);
          hiddenText = formatReferencedFiles(resolved) || undefined;
          refs = toMessageRefs(resolved);
        } catch { /* resolution must never block sending */ }
        setResolvingRefs(0);
      }
    }
    runTurn(text, { hiddenText, refs });
  }

  // Plan-approval driver + derivations live in planActions (pure, testable).
  function approvePlan() {
    approvePlanAction(live.id, dispatch, runTurn);
  }

  const last = live.messages[live.messages.length - 1];
  const showApprovePlan = planAwaitingApproval(live, busy);
  const cliApprovalHint = cliApprovalHintFor(live);

  return (
    // ── Layout: header · (timeline | messages) · working pill · composer · dialogs
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* ── Header: timeline toggle (left) + Clean/Verbose density (right) ── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 h-9 border-b border-border/70 bg-muted/5">
        <button
          onClick={() => setTimelineOpen((o) => !o)}
          title={timelineOpen ? 'Hide timeline' : 'Show timeline'}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {timelineOpen ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
          <span className="text-[11px] font-medium hidden sm:inline">Timeline</span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          <LogDensityToggle />
          <PanelMaximizeButton id="chat" />
        </div>
      </div>

      {/* ── Docked plan strip (default view): the session's latest plan as a
          collapsible top strip. In focus view the plan docks on the right
          instead (inside the body row below). Renders nothing without a plan. ── */}
      {!maximized && <AttachedPlanStrip session={live} />}

      {/* ── Body: timeline gutter + scrolling message list (+ right plan dock in
          focus view). `relative` so the timeline/plan can float over the wide
          side margins in focus view, keeping the centered column centered. ── */}
      <div className="flex flex-1 min-h-0 relative">
        {timelineOpen && (
          <div className={cn(
            'min-h-0 border-r border-border/70',
            // Focus view: float over the left margin so it doesn't inset the
            // centered message column. Default: inline gutter.
            maximized
              ? 'absolute left-0 top-0 bottom-0 w-[132px] z-20 bg-background/85 backdrop-blur-sm'
              : 'flex-shrink-0 w-[132px] bg-muted/5',
          )}>
            <ChatTimeline turns={turns} onScrollTo={scrollToMessage} activeMessageId={activeMsgId} />
          </div>
        )}

        {/* Focus view: plan docked on the right, floating over the right margin. */}
        {maximized && <AttachedPlanStrip session={live} maximized />}

        {/* Messages (scroll parent for scroll-to-message + auto-scroll) */}
        <div className="relative flex-1 min-h-0">
          <div ref={scrollRef} className={cn('absolute inset-0 overflow-y-auto', chatBgClass)}>
            {/* Inner content wrapper: RO target for stick-to-bottom + zoom scope
              (scales messages, not the header/composer). */}
            <div
              ref={contentRef}
              className={cn(
                'min-h-full',
                maximized
                  ? 'max-w-5xl mx-auto px-8 py-6 space-y-5'
                  : 'px-4 py-4 space-y-4',
              )}
              style={{
                ...(chatZoom !== 1 ? ({ zoom: chatZoom } as React.CSSProperties) : {}),
                ...(chatFontFamily ? { fontFamily: chatFontFamily } : {}),
              }}
            >
              {live.messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-6">
                  <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 text-primary" style={{ animation: 'none' }} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-foreground/85 font-medium">Ready when you are.</p>
                    <p className="text-xs text-muted-foreground/70 max-w-sm">
                      Ask the agent to read, refactor, or debug code — actions are gated by the access level above.
                    </p>
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground/50 mt-1">
                    Tip: type <span className="text-primary">@</span> to attach a file or folder as context.
                  </p>
                </div>
              )}
              {live.historyTrimmed && live.messages.length > 0 && (
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground/50">
                  <span className="flex-1 h-px bg-border/60" />
                  <span>Earlier messages were trimmed from local history</span>
                  <span className="flex-1 h-px bg-border/60" />
                </div>
              )}
              {live.messages.map((m) => {
                const isNew = !seenIdsRef.current!.has(m.id);
                if (isNew) seenIdsRef.current!.add(m.id);
                return (
                  <MessageView
                    key={m.id}
                    msg={m}
                    density={logDensity}
                    // Only the latest, settled assistant turn can still take answers.
                    interactive={!busy && m.id === last?.id && m.role === 'assistant' && !m.streaming}
                    busy={busy}
                    animateIn={isNew && !reducedMotion}
                    cliApprovalHint={cliApprovalHint}
                    onOpenQuestions={openQuestions}
                    onRevert={revertToMessage}
                    onApproveCliBypass={approveCliBypass}
                    onPendingAction={handlePendingAction}
                    onRetry={retryLastTurn}
                    registerRef={registerRef}
                  />
                );
              })}
              {pending && (
                <PendingActionCard
                  pending={pending}
                  onApprove={() => approvalResolver.current?.(true)}
                  onDeny={() => approvalResolver.current?.(false)}
                />
              )}
              {/* Bottom sentinel — a stable anchor for reliable jump-to-bottom. */}
              <div aria-hidden className="h-px w-full" />
            </div>
          </div>

          {/* Bottom-right controls: jump-to-latest (only when scrolled up) + a
            stick-to-bottom toggle to lock/unlock following new messages. */}
          <div className="absolute right-4 bottom-3 flex items-center gap-2">
            {!atBottom && (
              <button
                onClick={jumpToBottom}
                title="Jump to latest"
                aria-label="Scroll to bottom"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full
                         border border-border bg-background/80 backdrop-blur-sm shadow-md
                         text-muted-foreground hover:text-foreground opacity-70 hover:opacity-100 transition-opacity"
              >
                <ChevronDown className="w-3.5 h-3.5" />
                {unread > 0 && (
                  <span className="text-[10px] font-mono text-primary">{unread}</span>
                )}
              </button>
            )}
            <button
              onClick={() => { const next = !stick; setStick(next); if (next) scrollToBottom(true); }}
              title={stick ? 'Following new messages — click to unlock' : 'Not following — click to stick to bottom'}
              aria-label="Toggle stick to bottom"
              aria-pressed={stick}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full border shadow-md backdrop-blur-sm transition-colors',
                stick
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border bg-background/80 text-muted-foreground hover:text-foreground',
              )}
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Working indicator: keeps reasoning-only turns from feeling dead.
          Label rotates with the latest block kind (Thinking… / Reading… / …). ── */}
      {busy && (
        <div className="flex-shrink-0 border-t border-border/70 bg-muted/5 px-4 py-1.5">
          <div className={cn('flex items-center gap-2', maximized && 'max-w-3xl mx-auto')}>
            <Loader2 className="w-3 h-3 text-primary animate-spin" />
            <span className="text-[11px] text-muted-foreground">{workingLabel}</span>
          </div>
        </div>
      )}
      {!busy && resolvingRefs > 0 && (
        <div className="flex-shrink-0 border-t border-border/70 bg-muted/5 px-4 py-1.5">
          <div className={cn('flex items-center gap-2', maximized && 'max-w-3xl mx-auto')}>
            <Loader2 className="w-3 h-3 text-primary animate-spin" />
            <span className="text-[11px] text-muted-foreground">
              Resolving {resolvingRefs} reference{resolvingRefs > 1 ? 's' : ''}…
            </span>
          </div>
        </div>
      )}

      {/* ── Plan-pending hint: the plan renders in-chat as markdown; this notes
          the Send button is now an Approve action. ── */}
      {showApprovePlan && !input.trim() && (
        <div className="flex-shrink-0 border-t border-emerald-500/30 bg-emerald-500/5 px-4 py-1.5 text-[11px] text-muted-foreground">
          <div className={cn(maximized && 'max-w-3xl mx-auto')}>
            Plan ready — <span className="text-emerald-400 font-medium">Approve</span> to implement, or type feedback to revise it.
          </div>
        </div>
      )}

      {/* ── Composer: textarea + context-aware primary button, grouped as one
          control. Button is Stop (busy) / Approve (plan pending, empty) / Send.
          A gradient fade at the top reads as one continuous surface with the
          message list above; centered to the same max-width when maximized. ── */}
      <div className={cn(
        'flex-shrink-0 relative pt-3 pb-3',
        maximized ? 'px-8' : 'px-3',
      )}>
        <div className="pointer-events-none absolute -top-6 left-0 right-0 h-6 bg-gradient-to-t from-background to-transparent" />
        <div className={cn(
          'relative flex items-stretch gap-2 rounded-xl border bg-muted/10 p-1.5 transition-colors',
          'border-border/70 focus-within:border-primary/50 focus-within:bg-muted/20',
          maximized && 'max-w-5xl mx-auto',
        )}>
          <AnimatePresence>
            {atToken !== null && (
              <AtMentionMenu
                matches={atMatches}
                activeIndex={atIndex}
                loading={treeLoading}
                hint={!live.cwd ? '@ file references need a local project with a working directory.' : undefined}
                onSelect={applyAtSelection}
                onHover={setAtIndex}
              />
            )}
          </AnimatePresence>
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setAtToken(detectAtToken(e.target.value, e.target.selectionStart ?? e.target.value.length));
            }}
            onSelect={(e) => {
              // Caret moves (arrows, clicks) re-evaluate which @-token is active.
              const el = e.currentTarget;
              setAtToken(detectAtToken(el.value, el.selectionStart ?? el.value.length));
            }}
            onBlur={() => setAtToken(null)}
            onKeyDown={(e) => {
              // The @-menu owns navigation keys while open — checked BEFORE the
              // Enter-sends branch so selecting a file never fires a send.
              if (atToken !== null) {
                if (e.key === 'Escape') { e.preventDefault(); setAtToken(null); return; }
                if (atMatches.length > 0) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setAtIndex((i) => (i + 1) % atMatches.length); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setAtIndex((i) => (i - 1 + atMatches.length) % atMatches.length); return; }
                  if (e.key === 'Tab' || e.key === 'Enter') {
                    e.preventDefault();
                    applyAtSelection(atMatches[Math.min(atIndex, atMatches.length - 1)]);
                    return;
                  }
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={busy ? 'Working…'
              : showApprovePlan ? 'Approve the plan, or type feedback to revise it…'
                : 'Message the agent…  (@ to attach files, Enter to send, Shift+Enter for newline)'}
            disabled={busy}
            className="flex-1 h-14 resize-none rounded-lg bg-transparent px-2.5 py-2 text-sm
                       focus:outline-none disabled:opacity-60 placeholder:text-muted-foreground/50"
          />
          {busy ? (
            <Button
              onClick={stop}
              variant="destructive"
              title="Stop the agent"
              aria-label="Stop"
              className="h-14 rounded-lg px-5 flex items-center gap-1.5 self-stretch"
            >
              <Square className="w-4 h-4 fill-current" />
              <span className="hidden sm:inline">Stop</span>
            </Button>
          ) : showApprovePlan && !input.trim() ? (
            <Button
              onClick={approvePlan}
              title="Approve the plan and start implementing"
              className="h-14 rounded-lg px-5 flex items-center gap-1.5 self-stretch bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <Check className="w-4 h-4" />
              <span className="hidden sm:inline">Approve implementation</span>
              <span className="sm:hidden">Approve</span>
            </Button>
          ) : (
            <Button
              onClick={send}
              disabled={!input.trim()}
              className="h-14 rounded-lg px-5 self-stretch"
            >
              Send
            </Button>
          )}
        </div>
      </div>

      {/* ── Dialogs: single hoisted questions popup (avoids stacked modals) ── */}
      <QuestionsDialog
        open={!!activeQuestions}
        questions={activeQuestions?.list ?? []}
        onSubmit={(text) => { setActiveQuestions(null); runTurn(text); }}
        onDismiss={() => setActiveQuestions(null)}
      />
    </div>
  );
}
