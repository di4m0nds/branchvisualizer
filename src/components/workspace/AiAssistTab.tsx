// apps/branchvisualizer/src/components/workspace/AiAssistTab.tsx
// Phase 6 AI tab — streaming output, feature selector, per-feature session cache.
// Output is preserved per prompt type when switching between them.

import { useState, useRef, useCallback, useEffect } from 'react';
import { useAppContext } from '@/store/AppContext';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useAi, DEFAULT_AI_CONFIG, type AIConfig } from '@/hooks/useAi';
import AiSettingsPanel from '@/components/AiSettingsPanel';
import { buildPrompt, type AIFeatureId } from '@/lib/ai-prompts';
import { buildAIContext, buildSingleCommitContext } from '../../../../../services/composition/ai-context';
import { fetchCommitDetails, setToken } from '@/lib/github';
import { cn, copyToClipboard } from '@/lib/utils';
import { AI_ENABLED } from '@/lib/features';
import type { GraphNode } from '@/types';

// ─── Feature definitions ──────────────────────────────────────────────────────

interface FeatureDef {
  id: AIFeatureId;
  label: string;
  description: string;
  requiresCommit: boolean;
}

const FEATURES: FeatureDef[] = [
  { id: 'where_to_start',   label: 'Where to start?',       description: 'Guide for new contributors',    requiresCommit: false },
  { id: 'summarize_branch', label: 'Summarize branch',      description: 'Overview of recent commits',    requiresCommit: false },
  { id: 'explain_commit',   label: 'Explain this commit',   description: 'Explain the selected commit',   requiresCommit: true  },
  { id: 'pr_description',   label: 'Draft PR description',  description: 'Generate PR body from commits', requiresCommit: false },
];

// ─── Per-feature session cache ────────────────────────────────────────────────
// Each feature keeps its own output so switching tabs never wipes a result.

interface FeatureSession {
  output: string;
  error: string | null;
  /** For explain_commit — which commit the response was generated for. */
  forNode?: { sha: string; message: string };
}

type SessionMap = Record<AIFeatureId, FeatureSession>;

const EMPTY_SESSIONS: SessionMap = {
  where_to_start:   { output: '', error: null },
  summarize_branch: { output: '', error: null },
  explain_commit:   { output: '', error: null },
  pr_description:   { output: '', error: null },
  explain_file:     { output: '', error: null },
  ask_about_code:   { output: '', error: null },
};

// ─── AI config storage ────────────────────────────────────────────────────────

const LS_CONFIG_KEY = 'ca_ai_config';

function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(LS_CONFIG_KEY);
    if (raw) return { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_AI_CONFIG;
}

function persistConfig(c: AIConfig) {
  try {
    const { apiKey: _key, ...safe } = c;
    localStorage.setItem(LS_CONFIG_KEY, JSON.stringify(safe));
  } catch { /* ignore */ }
}

// ─── Commit pill ──────────────────────────────────────────────────────────────

function CommitPill({
  sha,
  message,
  faded,
  onClick,
}: {
  sha: string;
  message: string;
  faded?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`${sha}\n${message}`}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors max-w-full min-w-0',
        onClick
          ? 'cursor-pointer hover:bg-accent' : 'cursor-default',
        faded
          ? 'text-muted-foreground/50 bg-muted/20'
          : 'text-muted-foreground bg-muted/30',
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-60" />
      <span className="font-semibold shrink-0">{sha.slice(0, 7)}</span>
      <span className="truncate opacity-70">{message.split('\n')[0].slice(0, 48)}</span>
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AiAssistTab() {
  const { state, dispatch } = useAppContext();
  const { repoInfo, allCommits, selectedNode, token } = state;
  const { hasCapability } = useCapabilities();

  const [featureId, setFeatureId] = useState<AIFeatureId>('where_to_start');
  const [config, setConfig] = useState<AIConfig>(loadConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fetchingDetails, setFetchingDetails] = useState(false);

  // Per-feature output cache — switching features never clears a completed result
  const [sessions, setSessions] = useState<SessionMap>(EMPTY_SESSIONS);

  // Tracks which feature the active stream belongs to
  const activeFeatureRef = useRef<AIFeatureId | null>(null);

  const { output: streamOutput, loading, error: streamError, run, cancel, clear } = useAi();

  // ── Sync live stream into the active feature's session ────────────────────
  useEffect(() => {
    const feat = activeFeatureRef.current;
    if (!feat) return;
    setSessions(prev => ({
      ...prev,
      [feat]: { ...prev[feat], output: streamOutput, error: streamError },
    }));
  }, [streamOutput, streamError]);

  // ── Derived display values ─────────────────────────────────────────────────
  const isStreaming = loading && activeFeatureRef.current === featureId;
  const currentOutput  = isStreaming ? streamOutput : sessions[featureId].output;
  const currentError   = isStreaming ? streamError  : sessions[featureId].error;
  const currentSession = sessions[featureId];

  const selectedFeature = FEATURES.find(f => f.id === featureId) ?? FEATURES[0];
  const commitMissing   = selectedFeature.requiresCommit && !selectedNode;
  const isRunning       = isStreaming || fetchingDetails;

  // Stale result: output exists but was generated for a different commit
  const resultIsStale =
    featureId === 'explain_commit' &&
    !!currentSession.output &&
    !!currentSession.forNode &&
    selectedNode?.commit.sha !== currentSession.forNode.sha;

  // ── Feature flag + capability gate ────────────────────────────────────────
  if (!AI_ENABLED()) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        <span className="text-sm text-muted-foreground">AI features are not enabled.</span>
        <span className="text-xs text-muted-foreground/60">Set VITE_FEATURE_AI_PHASE6=true to enable.</span>
      </div>
    );
  }

  if (!hasCapability('ai:assist')) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" className="text-muted-foreground/40">
          <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 3.5a2 2 0 1 1 4 0V6H6V4.5z"/>
        </svg>
        <span className="text-sm text-muted-foreground">Sign in to use AI features</span>
      </div>
    );
  }

  if (!repoInfo) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        <span className="text-sm text-muted-foreground">Load a repository to use AI assistance</span>
      </div>
    );
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    if (!repoInfo || allCommits.length === 0) return;

    const forNode = (featureId === 'explain_commit' && selectedNode)
      ? { sha: selectedNode.commit.sha, message: selectedNode.commit.message }
      : undefined;

    // Reset this feature's session and clear the stream state
    setSessions(prev => ({
      ...prev,
      [featureId]: { output: '', error: null, forNode },
    }));
    clear();

    try {
      if (featureId === 'explain_commit' && selectedNode) {
        setFetchingDetails(true);
        setToken(token);
        const details = await fetchCommitDetails(repoInfo.owner, repoInfo.repo, selectedNode.commit.sha);
        setFetchingDetails(false);
        // Set ref immediately before run() so the sync effect can write to this session
        activeFeatureRef.current = featureId;
        const ctx = buildSingleCommitContext(repoInfo, details);
        run(buildPrompt({ featureId, ctx }), config);
      } else {
        // Set ref immediately before run() so the sync effect can write to this session
        activeFeatureRef.current = featureId;
        const ctx = buildAIContext(repoInfo, allCommits, { budget: { maxCommits: 10 }, branchNames: [] });
        run(buildPrompt({ featureId, ctx, branchName: repoInfo.defaultBranch }), config);
      }
    } catch (e) {
      setFetchingDetails(false);
      activeFeatureRef.current = null;
      setSessions(prev => ({
        ...prev,
        [featureId]: { ...prev[featureId], error: (e as Error)?.message ?? 'Failed to fetch commit details' },
      }));
    }
  }, [repoInfo, allCommits, selectedNode, token, featureId, config, run, clear]);

  const handleSwitchFeature = useCallback((id: AIFeatureId) => {
    // Cancel any in-progress stream that belongs to this feature; other features' streams keep going
    if (isStreaming) cancel();
    setFeatureId(id);
    // Do NOT call clear() — the session cache preserves each feature's output
  }, [isStreaming, cancel]);

  const handleJumpToCommit = useCallback((sha: string) => {
    const node = state.graphData?.nodes.find(n => n.commit.sha === sha) as GraphNode | undefined;
    if (node) dispatch({ type: 'SELECT_NODE', node });
    dispatch({ type: 'SCROLL_TO_SHA', sha });
  }, [state.graphData, dispatch]);

  const handleCopy = useCallback(async () => {
    if (!currentOutput) return;
    const ok = await copyToClipboard(currentOutput);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  }, [currentOutput]);

  const handleConfigChange = useCallback((c: AIConfig) => {
    setConfig(c);
    persistConfig(c);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-primary flex-shrink-0">
          <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/>
        </svg>
        <span className="text-xs font-medium text-foreground">AI Assist</span>
        <span className="text-[10px] text-muted-foreground/50 ml-0.5 font-mono">
          {config.provider}/{config.model.split('-').slice(-2).join('-')}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          {currentOutput && (
            <button
              onClick={handleCopy}
              title="Copy output"
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {copied
                ? <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="text-emerald-400"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.749.749 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>
                : <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
              }
            </button>
          )}
          <button
            onClick={() => setShowSettings(s => !s)}
            title="AI settings"
            className={cn(
              'w-6 h-6 flex items-center justify-center rounded transition-colors',
              showSettings ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.103-.303c-.066-.019-.176-.011-.299.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.212.224l-.288 1.107c-.17.645-.715 1.195-1.459 1.26a8.006 8.006 0 0 1-1.402 0c-.744-.065-1.29-.615-1.46-1.26l-.287-1.107c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.103.303c.066.019.176.011.299-.071.214-.143.437-.272.668-.386.133-.066.194-.158.212-.224l.287-1.107C5.45.645 5.996.095 6.74.031A8.19 8.19 0 0 1 8 0Zm-.5 4.75a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5ZM4.75 8.5a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0Z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Feature selector ── */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border flex-shrink-0 overflow-x-auto scrollbar-hide">
        {FEATURES.map(f => (
          <button
            key={f.id}
            onClick={() => handleSwitchFeature(f.id)}
            title={f.description}
            className={cn(
              'relative text-[10px] px-2 py-1 rounded flex-shrink-0 transition-colors border',
              featureId === f.id
                ? 'bg-primary/10 border-primary/30 text-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            {f.label}
            {/* Dot indicator: feature has cached output */}
            {sessions[f.id].output && featureId !== f.id && (
              <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-primary/50" />
            )}
          </button>
        ))}
      </div>

      {/* ── Commit context bar ── */}
      {featureId === 'explain_commit' && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/10 flex-shrink-0 min-w-0">
          {/* Selected commit */}
          <span className="text-[10px] text-muted-foreground/40 shrink-0">Selected:</span>
          {selectedNode
            ? (
              <CommitPill
                sha={selectedNode.commit.sha}
                message={selectedNode.commit.message}
                onClick={() => handleJumpToCommit(selectedNode.commit.sha)}
              />
            )
            : <span className="text-[10px] text-amber-400/70 italic">none — click a commit in the graph</span>
          }
        </div>
      )}

      {/* ── Stale result warning ── */}
      {resultIsStale && (
        <div className="mx-3 mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 flex items-center gap-2 flex-shrink-0">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="text-amber-400 shrink-0">
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM8 9a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm.25-5.25a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0Z"/>
          </svg>
          <span className="text-[10px] text-amber-400 flex-1">Result is for a different commit. Run again to explain the current selection.</span>
        </div>
      )}

      {/* ── Commit-missing notice ── */}
      {commitMissing && !resultIsStale && (
        <div className="mx-3 mt-2 p-2 rounded bg-muted/30 border border-border flex-shrink-0">
          <span className="text-[10px] text-muted-foreground">Select a commit in the graph to use this feature.</span>
        </div>
      )}

      {/* ── Output area ── */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">

        {/* "Generated for" attribution badge */}
        {currentSession.forNode && currentOutput && featureId === 'explain_commit' && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10px] text-muted-foreground/40">Explained:</span>
            <CommitPill
              sha={currentSession.forNode.sha}
              message={currentSession.forNode.message}
              faded={resultIsStale}
              onClick={() => handleJumpToCommit(currentSession.forNode!.sha)}
            />
          </div>
        )}

        {currentError && (
          <div className="p-2 rounded bg-red-500/10 border border-red-500/20 mb-2">
            <span className="text-xs text-red-400">{currentError}</span>
          </div>
        )}

        {currentOutput ? (
          <pre className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed">
            {currentOutput}
            {isStreaming && <span className="animate-pulse text-muted-foreground">▋</span>}
          </pre>
        ) : !isRunning && !currentError ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-8">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" className="text-muted-foreground/30">
              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/>
            </svg>
            <span className="text-xs text-muted-foreground/50">{selectedFeature.description}</span>
          </div>
        ) : isRunning && !currentOutput ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
            <span className="text-xs text-muted-foreground/50">
              {fetchingDetails ? 'Fetching commit details…' : 'Generating…'}
            </span>
          </div>
        ) : null}
      </div>

      {/* ── Footer: Run / Cancel ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border flex-shrink-0 bg-muted/10">
        {isRunning ? (
          <button
            onClick={cancel}
            className="flex-1 text-xs py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={commitMissing || !repoInfo}
            className={cn(
              'flex-1 text-xs py-1.5 rounded font-medium transition-all',
              commitMissing || !repoInfo
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:opacity-90',
            )}
          >
            {currentOutput ? 'Run again' : selectedFeature.label}
          </button>
        )}
      </div>

      {/* ── Settings panel ── */}
      {showSettings && (
        <AiSettingsPanel
          config={config}
          onChange={handleConfigChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
