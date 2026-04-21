// apps/branchvisualizer/src/components/workspace/AssistantTab.tsx
// T3-inspired AI assistant tab — full workspace chat for GitHub repos.
//
// Features:
//   • Per-instance activeSessionId (split-pane independent)
//   • Rich GitHub context: commit diffs, file trees, file attachment
//   • Resizable sidebar (drag handle)
//   • Improved design for dark + light themes
//   • Framer-motion animations ≤150ms

import { useState, useCallback, useRef, useEffect, forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, copyToClipboard } from '@/lib/utils';
import { useAppContext } from '@/store/AppContext';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useAi } from '@/hooks/useAi';
import { AI_ENABLED } from '@/lib/features';
import {
  useAssistantStore,
  DEFAULT_SESSION_CONFIG,
  type SessionMode,
  type AssistantMessage,
  type AssistantSessionConfig,
  type AssistantSession,
  loadFromServer,
  syncToServer,
  loadModelConfig,
  saveModelConfig,
} from '@/store/assistantStore';
import { useGitHubContext, type CommitDetail } from '@/hooks/useGitHubContext';
import SessionList from './assistant/SessionList';
import MessageBubble from './assistant/MessageBubble';
import ModelPicker from './assistant/ModelPicker';
import ChatComposer from './assistant/ChatComposer';
import type { GraphNode } from '@/types';

// ─── Constants ─────────────────────────────────────────────────────────────

const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 280;
const SIDEBAR_DEFAULT = 180;

// ─── ID generator ──────────────────────────────────────────────────────────

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Mode helpers ──────────────────────────────────────────────────────────

function modeLabel(mode: SessionMode): string {
  return mode === 'pr' ? 'PR' : mode === 'review' ? 'Review' : 'Chat';
}

function modeIcon(mode: SessionMode): React.ReactNode {
  if (mode === 'pr') return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z"/>
    </svg>
  );
  if (mode === 'review') return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/>
    </svg>
  );
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 13H8.061l-2.574 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Z"/>
    </svg>
  );
}

// ─── PR prompt builder ─────────────────────────────────────────────────────

function buildPRPrompt(nodes: GraphNode[]): string {
  if (nodes.length === 0) return 'Generate a comprehensive Pull Request description for this branch.';
  const list = nodes.slice(0, 15).map(n =>
    `- \`${n.commit.sha.slice(0, 7)}\` ${n.commit.subject ?? n.commit.message.split('\n')[0]}`
  ).join('\n');
  return `Generate a Pull Request description for these commits:\n\n${list}\n\nInclude: title, summary, motivation, changes, and testing notes. Use markdown.`;
}

// ─── Typing indicator ──────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[9px] text-muted-foreground flex-shrink-0">
        ✦
      </div>
      <div className="flex items-center gap-1 px-2.5 py-2 rounded-2xl rounded-tl-sm bg-card border border-border/50 shadow-sm">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce"
            style={{ animationDelay: `${i * 120}ms`, animationDuration: '900ms' }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Message timeline ──────────────────────────────────────────────────────

function MessageTimeline({ messages, streaming }: {
  messages: AssistantMessage[];
  streaming: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streaming]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 py-12 px-4 text-center">
        <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-primary/50">
            <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 13H8.061l-2.574 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Z"/>
          </svg>
        </div>
        <p className="text-xs text-muted-foreground">Send a message to start</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      <AnimatePresence initial={false}>
        {messages.map((msg, i) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
          >
            <MessageBubble message={msg} isLatest={i === messages.length - 1} />
          </motion.div>
        ))}
      </AnimatePresence>

      {streaming && messages[messages.length - 1]?.role === 'user' && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.1 }}
        >
          <TypingDots />
        </motion.div>
      )}
      <div ref={bottomRef} className="h-1" />
    </div>
  );
}

// ─── Context badge ─────────────────────────────────────────────────────────
// Uses forwardRef so AnimatePresence's internal PopChild can pass a ref to the
// underlying DOM element without the "ref is not a prop" React warning.

const ContextBadge = forwardRef<HTMLSpanElement, { label: string; onRemove?: () => void }>(
  function ContextBadge({ label, onRemove }, ref) {
    return (
      <motion.span
        ref={ref}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.1 }}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-[10px] text-primary/80 font-mono"
      >
        {label}
        {onRemove && (
          <button onClick={onRemove} className="ml-0.5 hover:text-destructive transition-colors">
            ×
          </button>
        )}
      </motion.span>
    );
  }
);

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptySessionState({ onNew }: { onNew: (mode: SessionMode) => void }) {
  const modes: { mode: SessionMode; title: string; desc: string }[] = [
    { mode: 'chat',   title: 'Free chat',      desc: 'Ask anything about the codebase' },
    { mode: 'pr',     title: 'PR description', desc: 'Generate from selected commits' },
    { mode: 'review', title: 'Code review',    desc: 'Review changes or a commit' },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" className="text-primary/70">
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/>
          </svg>
        </div>
        <p className="text-sm font-semibold text-foreground">Start a session</p>
        <p className="text-xs text-muted-foreground max-w-[200px] leading-relaxed">
          Pick a mode to begin. Sessions persist locally.
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-[240px]">
        {modes.map(({ mode, title, desc }) => (
          <button
            key={mode}
            onClick={() => onNew(mode)}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-border
                       bg-card/60 hover:bg-accent hover:border-border/80
                       transition-all duration-100 text-left group"
          >
            <div className="w-6 h-6 rounded-lg bg-muted/50 flex items-center justify-center
                            text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary
                            transition-colors flex-shrink-0">
              {modeIcon(mode)}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-foreground leading-none mb-0.5">{title}</p>
              <p className="text-[10px] text-muted-foreground/70">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Session header ─────────────────────────────────────────────────────────

function SessionHeader({
  session, onClear, onCopy, detailLoading,
}: {
  session: AssistantSession;
  onClear: () => void;
  onCopy: () => void;
  detailLoading: boolean;
}) {
  const count = session.messages.filter(m => m.role !== 'system').length;
  return (
    <>
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="text-muted-foreground/60 flex-shrink-0">
          {modeIcon(session.mode)}
        </span>
        <span className="text-xs font-medium text-foreground truncate">{session.title}</span>
        <span className={cn(
          'text-[9px] px-1 py-0.5 rounded font-medium border flex-shrink-0',
          session.mode === 'pr'
            ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
            : session.mode === 'review'
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
            : 'border-border/50 bg-muted/20 text-muted-foreground/60',
        )}>
          {modeLabel(session.mode)}
        </span>
        {count > 0 && (
          <span className="text-[9px] text-muted-foreground/30">{count}</span>
        )}
        {detailLoading && (
          <span className="w-2 h-2 rounded-full border border-primary/40 border-t-primary/80 animate-spin flex-shrink-0" />
        )}
      </div>

      {count > 0 && (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={onCopy}
            title="Copy conversation"
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40
                       hover:text-foreground hover:bg-accent transition-colors"
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
              <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
            </svg>
          </button>
          <button
            onClick={onClear}
            title="Clear messages"
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/40
                       hover:text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/>
            </svg>
          </button>
        </div>
      )}
    </>
  );
}

// ─── Main AssistantTab ─────────────────────────────────────────────────────

export default function AssistantTab() {
  const { state: appState, dispatch: appDispatch } = useAppContext();
  const { hasCapability } = useCapabilities();
  const { state, dispatch } = useAssistantStore();

  // ── Per-instance active session (enables split-pane independence) ──────────
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => state.sessions[0]?.id ?? null,
  );

  // Keep activeSessionId valid when sessions are deleted
  useEffect(() => {
    if (activeSessionId && !state.sessions.find(s => s.id === activeSessionId)) {
      setActiveSessionId(state.sessions[0]?.id ?? null);
    }
  }, [state.sessions, activeSessionId]);

  // ── Sidebar resize ─────────────────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, width: 0 });

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    resizeStartRef.current = { x: e.clientX, width: sidebarWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizeStartRef.current.x;
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, resizeStartRef.current.width + delta)));
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  // ── Provider API keys — keyed by provider ID, backed by sessionStorage ──────
  // sessionStorage survives React re-renders and page refreshes within the same
  // browser tab, but never reaches the server (security invariant maintained).
  // Keys are looked up by provider, not session, so they work across all sessions
  // that share the same provider.
  function loadProviderKeysFromStorage(): Record<string, string> {
    const result: Record<string, string> = {};
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k?.startsWith('ca:ai:key:')) {
          const val = sessionStorage.getItem(k);
          if (val) result[k.slice('ca:ai:key:'.length)] = val;
        }
      }
    } catch { /* sessionStorage unavailable in some contexts */ }
    return result;
  }
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>(loadProviderKeysFromStorage);

  const updateProviderKey = useCallback((provider: string, key: string) => {
    try {
      if (key) sessionStorage.setItem(`ca:ai:key:${provider}`, key);
      else sessionStorage.removeItem(`ca:ai:key:${provider}`);
    } catch { /* ignore */ }
    setProviderKeys(prev => ({ ...prev, [provider]: key }));
  }, []);

  // ── Server-loaded model config (used as base for new sessions) ─────────────
  const loadedServerConfigRef = useRef<AssistantSessionConfig | null>(null);
  // Whether we've already loaded from server this mount cycle
  const serverLoadDoneRef = useRef(false);

  // ── Dedup guard — prevents React StrictMode double-invocation of doCreate ───
  // Time-windowed: same key within 300ms is treated as duplicate (StrictMode fires
  // the same effect twice within a few ms). After 300ms the same commit can be
  // explained again, which is the correct user-facing behaviour.
  const lastAiChatRequestKeyRef = useRef<{ key: string; ts: number } | null>(null);

  // ── Pending auto-send (deferred when ModelPicker needed) ───────────────────
  interface PendingAutoSend {
    sessionId: string;
    prompt: string;
    mode: SessionMode;
    overrideNodes: GraphNode[];
    fetchedDetails: CommitDetail[];
  }
  const pendingAutoSendRef = useRef<PendingAutoSend | null>(null);

  // ── ModelPicker open trigger (increment to programmatically open) ──────────
  const [modelPickerOpenTrigger, setModelPickerOpenTrigger] = useState(0);

  // ── AI streaming ──────────────────────────────────────────────────────────
  const { run, cancel: aiCancel, output: aiOutput, loading: aiLoading, error: aiError, clear: aiClear, tokenUsage } = useAi();
  const streamingSessionRef = useRef<string | null>(null);
  // Tracks the exact message ID being streamed so UPDATE_MESSAGE doesn't need
  // to search state.sessions (which caused an infinite render loop).
  const streamingMessageIdRef = useRef<string | null>(null);

  // ── GitHub context ────────────────────────────────────────────────────────
  const { repoInfo, allCommits, selectedNode, selectedNodes, branches, aiChatRequest } = appState;
  const branchNames = branches.map(b => b.name);
  const {
    commitDetails,
    detailLoading,
    attachedFiles,
    loadSelectedCommits,
    loadDetailsByShas,
    fetchKeyFileContents,
    loadRepoTree,
    attachFile,
    removeFile,
    buildContext,
  } = useGitHubContext();

  // Auto-load commit details when selection changes.
  // loadSelectedCommits is stable (empty deps in useGitHubContext) so this
  // effect only re-fires when the actual selection or repo changes.
  useEffect(() => {
    const nodes = selectedNodes.length > 0 ? selectedNodes : selectedNode ? [selectedNode] : [];
    if (nodes.length > 0 && repoInfo) {
      loadSelectedCommits(nodes, repoInfo);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, selectedNodes, repoInfo]);

  // Auto-load repo tree once per repo.
  // loadRepoTree is stable and guards itself against duplicate calls.
  useEffect(() => {
    if (repoInfo) loadRepoTree(repoInfo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoInfo]);

  // ── Handle external "Ask AI" requests from DetailPanel / ComparePanel ──────
  useEffect(() => {
    if (!aiChatRequest || !repoInfo) return;
    const { shas, mode } = aiChatRequest;

    // Deduplicate: React StrictMode (dev) double-invokes effects within a few ms.
    // Use a time-windowed fingerprint: same key within 300ms = duplicate, ignore.
    // After 300ms the user can legitimately re-explain the same commit.
    const reqKey = shas.join(',') + ':' + mode;
    const now = Date.now();
    if (
      lastAiChatRequestKeyRef.current?.key === reqKey &&
      now - lastAiChatRequestKeyRef.current.ts < 300
    ) return;
    lastAiChatRequestKeyRef.current = { key: reqKey, ts: now };

    // Build title and initial prompt
    const short = shas.map(s => s.slice(0, 7)).join(' ↔ ');
    const title = mode === 'compare'
      ? `Compare ${short}`
      : `Commit ${short}`;
    const prompt = mode === 'compare'
      ? `Compare commits \`${shas[0].slice(0,7)}\` and \`${shas[1]?.slice(0,7) ?? ''}\`. Explain all the differences: what changed, why it matters, and any risks.`
      : `Explain commit \`${shas[0].slice(0,7)}\` in detail: what changed, why, any risks or patterns worth noting.`;

    // Fetch the commit details so the context has the diff
    const nodes = shas
      .map(sha => appState.graphData?.nodes.find(n => n.commit.sha === sha || n.commit.sha.startsWith(sha)))
      .filter((n): n is NonNullable<typeof n> => !!n);

    const doCreate = async () => {
      // Fetch details for commits found in the graph
      const nodeDetails = nodes.length > 0
        ? await loadSelectedCommits(nodes, repoInfo)
        : [];

      // For SHAs not found in graph nodes, fetch directly via the commit-context API.
      // This is the fix for: "commit X is not present in the provided commit history"
      // — which happened when the user's clicked commit wasn't in the loaded graph.
      // Uses startsWith matching so any SHA length (7–40 chars) is handled correctly.
      const unresolvedShas = shas.filter(sha =>
        !nodes.some(n => n.commit.sha === sha || n.commit.sha.startsWith(sha))
      );
      const directDetails = unresolvedShas.length > 0
        ? await loadDetailsByShas(unresolvedShas, repoInfo)
        : [];

      const fetchedDetails = [...nodeDetails, ...directDetails];

      // Inherit the current session's model/provider so the user doesn't have
      // to re-configure their preferred model after clicking "Ask AI".
      const inheritedConfig = activeSession
        ? { ...activeSession.config }
        : { ...(loadedServerConfigRef.current ?? DEFAULT_SESSION_CONFIG) };

      // Check for a usable key using the provider-keyed store (not session-keyed).
      // This finds the key regardless of which session was last active.
      const inheritedKey = providerKeys[inheritedConfig.provider];
      const hasUsableKey = inheritedConfig.useProxy || !!inheritedKey;

      const session: AssistantSession = {
        id: genId(),
        title,
        mode: mode === 'compare' ? 'review' : 'chat',
        config: inheritedConfig,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        streaming: false,
      };
      dispatch({ type: 'CREATE_SESSION', session });
      setActiveSessionId(session.id);
      appDispatch({ type: 'CLEAR_AI_CHAT_REQUEST' });

      if (!hasUsableKey) {
        // No API key configured — open ModelPicker and defer the send
        pendingAutoSendRef.current = {
          sessionId: session.id,
          prompt,
          mode: session.mode,
          overrideNodes: nodes,
          fetchedDetails,
        };
        setModelPickerOpenTrigger(t => t + 1);
        return;
      }

      // Small delay to let dispatched state settle before sending
      setTimeout(() => {
        handleSendMessage(session.id, prompt, session.config, session.mode, undefined, nodes, fetchedDetails);
      }, 120);
    };

    doCreate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiChatRequest]);

  // Derived
  const activeSession = state.sessions.find(s => s.id === activeSessionId) ?? null;
  const isStreamingThis = !!(activeSession?.streaming && streamingSessionRef.current === activeSessionId && aiLoading);

  // ── Sync live stream output into messages ─────────────────────────────────
  // IMPORTANT: state.sessions is intentionally NOT in deps here. Including it
  // caused an infinite loop: dispatch(UPDATE_MESSAGE) → sessions ref changes →
  // effect fires again with same aiOutput → another dispatch → loop.
  // streamingMessageIdRef.current tracks the target message ID directly so we
  // never need to search state.sessions inside this effect.
  useEffect(() => {
    const sid = streamingSessionRef.current;
    const mid = streamingMessageIdRef.current;
    if (!sid || !mid || !aiLoading || !aiOutput) return;
    dispatch({ type: 'UPDATE_MESSAGE', sessionId: sid, messageId: mid, content: aiOutput });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOutput, aiLoading, dispatch]);

  // ── Finalize when streaming ends ──────────────────────────────────────────
  // Reads aiOutput/aiError/tokenUsage from closure — by the time aiLoading
  // flips to false, all state updates from the stream are already batched in.
  useEffect(() => {
    const sid = streamingSessionRef.current;
    const mid = streamingMessageIdRef.current;
    if (!sid || !mid || aiLoading) return;
    dispatch({
      type: 'FINALIZE_MESSAGE',
      sessionId: sid,
      messageId: mid,
      content: aiError ? `_Error: ${aiError}_` : (aiOutput || ''),
      tokenUsage: tokenUsage ?? undefined,
    });
    dispatch({ type: 'SET_STREAMING', sessionId: sid, streaming: false });
    streamingSessionRef.current = null;
    streamingMessageIdRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiLoading]);

  // ── Create session ────────────────────────────────────────────────────────
  const handleNewSession = useCallback((mode: SessionMode = 'chat') => {
    const session: AssistantSession = {
      id: genId(),
      title: mode === 'pr' ? 'PR Description' : mode === 'review' ? 'Code Review' : 'New chat',
      mode,
      config: { ...(loadedServerConfigRef.current ?? DEFAULT_SESSION_CONFIG) },
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      streaming: false,
    };
    dispatch({ type: 'CREATE_SESSION', session });
    setActiveSessionId(session.id);

    if (mode === 'pr') {
      const nodes = selectedNodes.length > 0 ? selectedNodes : selectedNode ? [selectedNode] : [];
      if (nodes.length > 0) {
        const autoPrompt = buildPRPrompt(nodes as GraphNode[]);
        setTimeout(() => {
          handleSendMessage(session.id, autoPrompt, session.config, mode, undefined);
        }, 80);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, selectedNodes, selectedNode]);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(async (
    sessionId: string,
    text: string,
    config: AssistantSessionConfig,
    mode: SessionMode,
    attachedNode?: GraphNode,
    /** When provided (Ask AI flow), use these nodes instead of graph selection. */
    overrideNodes?: GraphNode[],
    /** When provided, inject directly into context — bypasses stale ref (Bug 4). */
    fetchedDetails?: CommitDetail[],
  ) => {
    if (!text.trim()) return;

    // Cancel any in-flight stream for another session
    if (streamingSessionRef.current && streamingSessionRef.current !== sessionId) {
      aiCancel();
      const sid = streamingSessionRef.current;
      dispatch({ type: 'SET_STREAMING', sessionId: sid, streaming: false });
      const prev = state.sessions.find(s => s.id === sid);
      if (prev) {
        const last = prev.messages[prev.messages.length - 1];
        if (last?.role === 'assistant' && last.streaming) {
          dispatch({ type: 'FINALIZE_MESSAGE', sessionId: sid, messageId: last.id, content: last.content || '[Cancelled]' });
        }
      }
    }

    // User message
    const userMsg: AssistantMessage = {
      id: genId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      context: attachedNode ? {
        sha: attachedNode.commit.sha,
        commitSubject: attachedNode.commit.subject ?? attachedNode.commit.message.split('\n')[0],
      } : undefined,
    };
    dispatch({ type: 'ADD_MESSAGE', sessionId, message: userMsg });

    // Placeholder assistant message
    const assistantMsg: AssistantMessage = {
      id: genId(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      streaming: true,
    };
    dispatch({ type: 'ADD_MESSAGE', sessionId, message: assistantMsg });
    dispatch({ type: 'SET_STREAMING', sessionId, streaming: true });
    // Track the exact message ID so the streaming effects don't need state.sessions
    streamingMessageIdRef.current = assistantMsg.id;

    // Use override nodes when provided (Ask AI flow), else fall back to graph selection
    const contextNodes = overrideNodes ?? (selectedNodes.length > 0 ? selectedNodes : selectedNode ? [selectedNode] : []);

    // Resolve all commit details needed for context.
    // For Ask AI flows: fetchedDetails were already resolved by doCreate — use directly.
    // For manual chat: fetch context-node details + resolve any SHAs mentioned in the
    //   message text (including commits that are NOT in the loaded graph).
    let resolvedDetails: CommitDetail[] | undefined = fetchedDetails;

    if (!overrideNodes && repoInfo) {
      // Step 1: load details for the currently selected context nodes
      const nodeDetails = contextNodes.length > 0
        ? await loadSelectedCommits(contextNodes, repoInfo)
        : [];

      const mentionedShas = Array.from(new Set(
        [...text.matchAll(/\b([0-9a-f]{7,40})\b/gi)].map(m => m[1].toLowerCase()),
      ));

      let mentionDetails: CommitDetail[] = [];
      if (mentionedShas.length > 0) {
        const contextNodeShas = new Set(contextNodes.map(n => n.commit.sha));
        // Step 2: mentioned SHAs that ARE in the graph → load via nodes
        const mentionedNodes = mentionedShas
          .map(sha => appState.graphData?.nodes.find(
            n => n.commit.sha.startsWith(sha) || n.commit.sha === sha
          ))
          .filter((n): n is NonNullable<typeof n> => !!n && !contextNodeShas.has(n.commit.sha));
        if (mentionedNodes.length > 0) {
          const fromGraph = await loadSelectedCommits(mentionedNodes, repoInfo);
          mentionDetails = [...mentionDetails, ...fromGraph];
        }
        // Step 3: mentioned SHAs NOT in graph at all → fetch directly by SHA
        // Uses startsWith matching to handle any short-SHA length (7, 8, 12, etc.)
        const unresolvedMentions = mentionedShas.filter(sha =>
          !appState.graphData?.nodes.some(n => n.commit.sha === sha || n.commit.sha.startsWith(sha))
        );
        if (unresolvedMentions.length > 0) {
          const direct = await loadDetailsByShas(unresolvedMentions, repoInfo);
          mentionDetails = [...mentionDetails, ...direct];
        }
      }

      // Merge and deduplicate — context nodes first, then mentioned extras
      const combined = [...nodeDetails, ...mentionDetails];
      if (combined.length > 0) {
        const seen = new Set<string>();
        resolvedDetails = combined.filter(d => {
          if (seen.has(d.sha)) return false;
          seen.add(d.sha);
          return true;
        });
      }
    }

    // Fetch full source of key changed files to give the AI surrounding code
    // context beyond the ±3-line diff window. Runs in parallel with fast path.
    // Best-effort: failures are silent (fetchKeyFileContents handles them internally).
    let keyFileContents;
    if (repoInfo && resolvedDetails && resolvedDetails.length > 0) {
      keyFileContents = await fetchKeyFileContents(resolvedDetails, repoInfo).catch(() => undefined);
    }

    // Build context-rich system prompt.
    // resolvedDetails bypasses stale commitDetailsRef so the AI always gets
    // the full diff/PR context even for commits not yet in the React state tree.
    const systemContent = buildContext({
      repoInfo,
      allCommits,
      branches: branchNames,
      selectedNodes: contextNodes,
      overrideDetails: resolvedDetails,
      keyFileContents,
    });

    // Build user content
    let userContent = text;
    if (attachedNode) {
      userContent = `[Commit \`${attachedNode.commit.sha.slice(0, 7)}\` — ${attachedNode.commit.subject ?? ''}]\n\n${text}`;
    }

    streamingSessionRef.current = sessionId;
    aiClear();

    // Look up key by provider — works across all sessions for that provider
    const apiKey = providerKeys[config.provider] ?? config.apiKey;
    run(
      { system: systemContent, user: userContent },
      { provider: config.provider, model: config.model, apiKey, useProxy: config.useProxy },
    );
  }, [
    state.sessions,
    dispatch,
    repoInfo,
    allCommits,
    branchNames,
    selectedNode,
    selectedNodes,
    providerKeys,
    aiCancel,
    aiClear,
    run,
    buildContext,
    loadSelectedCommits,
    loadDetailsByShas,
    fetchKeyFileContents,
    appState.graphData,
  ]);

  // Keep a ref to the latest handleSendMessage so the pending-auto-send effect
  // can call it without listing it as a dependency (avoids stale-closure issue).
  const handleSendMessageRef = useRef(handleSendMessage);
  handleSendMessageRef.current = handleSendMessage;

  // ── Fire pending auto-send when a key becomes available (Bug 1) ───────────
  // This effect fires on every providerKeys or sessions change. If there is
  // a pending auto-send and the target session now has a usable key (either
  // the user just set an API key in ModelPicker, or enabled useProxy), we
  // immediately fire the deferred handleSendMessage and clear the pending ref.
  useEffect(() => {
    const pending = pendingAutoSendRef.current;
    if (!pending) return;

    const pendingSession = state.sessions.find(s => s.id === pending.sessionId);
    if (!pendingSession) {
      pendingAutoSendRef.current = null;
      return;
    }

    const keyForProvider = providerKeys[pendingSession.config.provider];
    const hasUsableKey = pendingSession.config.useProxy || !!keyForProvider;

    if (hasUsableKey) {
      pendingAutoSendRef.current = null;
      handleSendMessageRef.current(
        pending.sessionId,
        pending.prompt,
        pendingSession.config,
        pending.mode,
        undefined,
        pending.overrideNodes,
        pending.fetchedDetails,
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerKeys, state.sessions]);

  // ── Delete session ────────────────────────────────────────────────────────
  const handleDeleteSession = useCallback((id: string) => {
    if (streamingSessionRef.current === id) { aiCancel(); streamingSessionRef.current = null; }
    dispatch({ type: 'DELETE_SESSION', id });
    if (activeSessionId === id) {
      const remaining = state.sessions.filter(s => s.id !== id);
      setActiveSessionId(remaining[0]?.id ?? null);
    }
    // Background delete from server — best-effort, non-blocking
    fetch(`/api/assistant/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {/* silent fallback */});
  }, [aiCancel, dispatch, activeSessionId, state.sessions]);

  const handleClearMessages = useCallback(() => {
    if (!activeSession) return;
    dispatch({ type: 'CLEAR_MESSAGES', sessionId: activeSession.id });
  }, [activeSession, dispatch]);

  const handleCopyConversation = useCallback(async () => {
    if (!activeSession) return;
    const text = activeSession.messages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? 'You' : 'Assistant'}:\n${m.content}`)
      .join('\n\n---\n\n');
    await copyToClipboard(text);
  }, [activeSession]);

  const handleConfigUpdate = useCallback((update: Partial<AssistantSessionConfig>) => {
    if (!activeSession) return;
    dispatch({ type: 'UPDATE_CONFIG', sessionId: activeSession.id, config: update });
    // Persist provider/model/useProxy to server — strip apiKey (never persisted)
    const newConfig = { ...activeSession.config, ...update };
    saveModelConfig({
      provider: newConfig.provider,
      model: newConfig.model,
      useProxy: newConfig.useProxy,
    }).catch(() => {/* silent fallback */});
  }, [activeSession, dispatch]);

  // ── Server sync: load on first mount after repoInfo resolves (Bug 3) ────────
  useEffect(() => {
    if (!repoInfo || serverLoadDoneRef.current) return;
    serverLoadDoneRef.current = true;

    loadFromServer(dispatch);

    loadModelConfig().then(cfg => {
      if (!cfg) return;
      const loaded: AssistantSessionConfig = {
        provider: cfg.provider as import('@codeatlas/ai').AIProviderId,
        model: cfg.model,
        useProxy: cfg.useProxy,
      };
      loadedServerConfigRef.current = loaded;
      // Apply to active session only if it still has the default config
      const cur = state.sessions.find(s => s.id === activeSessionId);
      if (cur &&
          cur.config.provider === DEFAULT_SESSION_CONFIG.provider &&
          cur.config.model === DEFAULT_SESSION_CONFIG.model) {
        dispatch({ type: 'UPDATE_CONFIG', sessionId: cur.id, config: loaded });
      }
    }).catch(() => {/* silent fallback */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoInfo]);

  // ── Server sync: debounced push on every sessions change (Bug 3) ──────────
  useEffect(() => {
    syncToServer(state.sessions);
  }, [state.sessions]);

  // ─── Gates ────────────────────────────────────────────────────────────────
  if (!AI_ENABLED()) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        <p className="text-sm text-muted-foreground">AI features are not enabled.</p>
        <p className="text-xs text-muted-foreground/60">Set VITE_FEATURE_AI_PHASE6=true to enable.</p>
      </div>
    );
  }
  if (!hasCapability('ai:assist')) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" className="text-muted-foreground/40">
          <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 3.5a2 2 0 1 1 4 0V6H6V4.5z"/>
        </svg>
        <p className="text-sm text-muted-foreground">Sign in to use AI features</p>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-background">

      {/* ── Sidebar ──
           Width is controlled by direct state (instantaneous during resize).
           Only opacity is animated via framer-motion so resize stays smooth. */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.div
            ref={sidebarRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="flex-shrink-0 flex overflow-hidden border-r border-border/60"
            style={{ width: sidebarWidth }}
          >
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              <SessionList
                sessions={state.sessions}
                activeSessionId={activeSessionId}
                onSelect={setActiveSessionId}
                onDelete={handleDeleteSession}
                onNew={handleNewSession}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Resize handle ── */}
      {sidebarOpen && (
        <div
          onMouseDown={onResizeStart}
          className="w-1 flex-shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50
                     transition-colors duration-100 group relative"
          title="Drag to resize"
        >
          <div className="absolute inset-y-0 -left-0.5 -right-0.5 group-hover:bg-primary/20 transition-colors" />
        </div>
      )}

      {/* ── Main chat area ── */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0">

        {/* Top bar */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/60 flex-shrink-0 bg-background/80 backdrop-blur-sm">
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/50
                       hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              {sidebarOpen
                ? <path d="M5.5 0a.5.5 0 0 1 .5.5v15a.5.5 0 0 1-1 0V.5a.5.5 0 0 1 .5-.5ZM2 1h3v14H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Zm7 0h5a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9V1Z"/>
                : <path d="M2 1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Zm0 1v12h12V2Z"/>
              }
            </svg>
          </button>

          <div className="w-px h-3.5 bg-border/60 flex-shrink-0" />

          {/* Session header or repo info */}
          {activeSession ? (
            <SessionHeader
              session={activeSession}
              onClear={handleClearMessages}
              onCopy={handleCopyConversation}
              detailLoading={detailLoading}
            />
          ) : (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="text-primary/60 flex-shrink-0">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/>
              </svg>
              <span className="text-xs font-semibold text-foreground/80">AI Assistant</span>
              {repoInfo && (
                <span className="text-[9px] text-muted-foreground/50 font-mono truncate">
                  {repoInfo.fullName}
                </span>
              )}
            </div>
          )}

          {/* Context indicators */}
          {(selectedNodes.length > 0 || (selectedNode && selectedNodes.length === 0)) && (
            <div className="flex-shrink-0">
              <AnimatePresence>
                {(selectedNodes.length > 0 ? selectedNodes : selectedNode ? [selectedNode] : [])
                  .slice(0, 2).map(n => (
                    <ContextBadge
                      key={n.commit.sha}
                      label={n.commit.sha.slice(0, 7)}
                    />
                  ))
                }
                {selectedNodes.length > 2 && (
                  <ContextBadge label={`+${selectedNodes.length - 2}`} />
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Content */}
        {!activeSession ? (
          <EmptySessionState onNew={handleNewSession} />
        ) : (
          <>
            {/* File attachments bar */}
            {attachedFiles.length > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/40 bg-muted/20 flex-shrink-0 flex-wrap">
                <span className="text-[9px] text-muted-foreground/50 font-medium uppercase tracking-wide">Files:</span>
                <AnimatePresence>
                  {attachedFiles.map(f => (
                    <ContextBadge
                      key={f.path}
                      label={f.path.split('/').pop() ?? f.path}
                      onRemove={() => removeFile(f.path)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* Message timeline */}
            <div className="flex-1 overflow-y-auto min-h-0 scroll-smooth">
              <MessageTimeline
                messages={activeSession.messages}
                streaming={isStreamingThis}
              />
            </div>

            {/* Composer footer */}
            <div className="flex-shrink-0 border-t border-border/60 bg-background/80">
              {/* Model picker row */}
              <div className="flex items-center gap-2 px-2 pt-1.5 pb-0">
                <ModelPicker
                  config={activeSession.config}
                  onChange={handleConfigUpdate}
                  apiKey={providerKeys[activeSession.config.provider]}
                  onApiKeyChange={key => updateProviderKey(activeSession.config.provider, key)}
                  openTrigger={modelPickerOpenTrigger}
                />
                <button
                  onClick={() => handleConfigUpdate({ useProxy: !activeSession.config.useProxy })}
                  title={activeSession.config.useProxy ? 'Using proxy' : 'Using direct API'}
                  className={cn(
                    'text-[9px] px-1.5 py-0.5 rounded border transition-colors ml-auto',
                    activeSession.config.useProxy
                      ? 'border-primary/30 bg-primary/10 text-primary/70'
                      : 'border-border/40 text-muted-foreground/40 hover:border-border',
                  )}
                >
                  {activeSession.config.useProxy ? 'proxy' : 'direct'}
                </button>
              </div>

              {/* Composer */}
              <ChatComposer
                onSend={(text, node) => handleSendMessage(
                  activeSession.id, text, activeSession.config, activeSession.mode, node,
                )}
                onCancel={() => aiCancel()}
                onAttachFile={repoInfo ? (path, ref) => attachFile(path, ref, repoInfo) : undefined}
                streaming={isStreamingThis}
                disabled={false}
                selectedNode={selectedNode}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
