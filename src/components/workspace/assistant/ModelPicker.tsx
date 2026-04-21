// apps/branchvisualizer/src/components/workspace/assistant/ModelPicker.tsx
// Full modal model + provider picker with connection test.

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { PROVIDERS, streamAI } from '@codeatlas/ai';
import type { AIProviderId } from '@codeatlas/ai';
import type { AssistantSessionConfig } from '@/store/assistantStore';

// ─── Provider brand colours ───────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#d4a27a',
  openai:    '#74aa9c',
  codex:     '#9e7bea',
  gemini:    '#4285f4',
  groq:      '#f55036',
  grok:      '#1da1f2',
  minimax:   '#ff6b6b',
};

function ProviderDot({ provider, size = 8 }: { provider: string; size?: number }) {
  return (
    <span
      className="rounded-full flex-shrink-0 inline-block"
      style={{
        width: size,
        height: size,
        backgroundColor: PROVIDER_COLORS[provider] ?? '#888',
      }}
    />
  );
}

// ─── Context window pretty-print ─────────────────────────────────────────────

function fmtCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// ─── Connection test ──────────────────────────────────────────────────────────

type TestStatus = 'idle' | 'testing' | 'ok' | 'error';

interface TestState {
  status: TestStatus;
  latencyMs?: number;
  error?: string;
}

async function runConnectionTest(
  config: AssistantSessionConfig,
  apiKey: string | undefined,
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const t0 = Date.now();
  const testSystem = 'You are a connectivity test assistant.';
  const testUser = 'Reply with exactly one word: ok';

  // ── Direct mode: call provider from the browser (same path as actual chat) ──
  // The backend proxy requires GitHub authentication. In direct mode the real
  // chat bypasses the backend entirely via streamAI — the test must do the same,
  // otherwise it always returns 403 for non-GitHub-authenticated users.
  if (!config.useProxy && apiKey) {
    const ctrl = new AbortController();
    let gotChunk = false;
    try {
      for await (const chunk of streamAI({
        provider: config.provider as AIProviderId,
        model: config.model,
        messages: [
          { role: 'system', content: testSystem },
          { role: 'user',   content: testUser   },
        ],
        apiKey,
        signal: ctrl.signal,
      })) {
        if (chunk.type === 'delta' && chunk.text) {
          gotChunk = true;
          ctrl.abort(); // first token received — test passed
          break;
        }
        if (chunk.type === 'error') {
          throw new Error(chunk.message);
        }
      }
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e: unknown) {
      const latencyMs = Date.now() - t0;
      // AbortError from our own ctrl.abort() after first token → success
      if (gotChunk || (e instanceof Error && e.name === 'AbortError')) {
        return { ok: true, latencyMs };
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs };
    }
  }

  // ── Proxy mode: call backend (requires GitHub auth / server-side key) ────────
  let intentionalAbort = false;
  const controller = new AbortController();
  try {
    const res = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: config.provider,
        model: config.model,
        apiKey: apiKey ?? undefined,
        system: testSystem,
        user: testUser,
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { ok: false, error: `${res.status}: ${text.slice(0, 120)}`, latencyMs };
    }
    intentionalAbort = true;
    controller.abort();
    return { ok: true, latencyMs };
  } catch (e: unknown) {
    const latencyMs = Date.now() - t0;
    if (intentionalAbort) return { ok: true, latencyMs };
    return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs };
  }
}

// ─── Model picker ─────────────────────────────────────────────────────────────

interface ModelPickerProps {
  config: AssistantSessionConfig;
  onChange: (update: Partial<AssistantSessionConfig>) => void;
  apiKey?: string;
  onApiKeyChange?: (key: string) => void;
  /** Increment this counter to programmatically open the picker (e.g. when a key is required). */
  openTrigger?: number;
}

// Derives which providers have a key stored in sessionStorage
function getConnectedProviders(): Set<string> {
  const connected = new Set<string>();
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith('ca:ai:key:') && sessionStorage.getItem(k)) {
        connected.add(k.slice('ca:ai:key:'.length));
      }
    }
  } catch { /* ignore */ }
  return connected;
}

export default function ModelPicker({ config, onChange, apiKey, onApiKeyChange, openTrigger }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>(config.provider);
  const [testState, setTestState] = useState<TestState>({ status: 'idle' });
  const [showKey, setShowKey] = useState(false);
  const [connectedProviders, setConnectedProviders] = useState<Set<string>>(getConnectedProviders);

  const triggerRef = useRef<HTMLButtonElement>(null);

  const currentProvider = PROVIDERS.find(p => p.id === config.provider);
  const currentModel = currentProvider?.models.find(m => m.id === config.model);
  const focusedProvider = PROVIDERS.find(p => p.id === selectedProvider) ?? PROVIDERS[0];

  // Open picker programmatically when openTrigger increments
  useEffect(() => {
    if (openTrigger && openTrigger > 0) setOpen(true);
  }, [openTrigger]);

  // Reset test state and sync selected provider when modal opens; refresh connected set
  useEffect(() => {
    if (open) {
      setSelectedProvider(config.provider);
      setTestState({ status: 'idle' });
      setShowKey(false);
      setConnectedProviders(getConnectedProviders());
    }
  }, [open, config.provider]);

  // Refresh connected providers whenever the key changes (user typed a key)
  useEffect(() => {
    setConnectedProviders(getConnectedProviders());
  }, [apiKey]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const handleSelect = useCallback(
    (providerId: AIProviderId, modelId: string) => {
      onChange({ provider: providerId, model: modelId });
      setTestState({ status: 'idle' });
    },
    [onChange],
  );

  const handleTest = useCallback(async () => {
    setTestState({ status: 'testing' });
    const result = await runConnectionTest(config, apiKey);
    setTestState(
      result.ok
        ? { status: 'ok', latencyMs: result.latencyMs }
        : { status: 'error', error: result.error, latencyMs: result.latencyMs },
    );
  }, [config, apiKey]);

  const modal = (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="fixed z-[201] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                       w-[580px] max-w-[96vw] max-h-[80vh]
                       bg-card border border-border rounded-2xl shadow-2xl
                       flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 flex-shrink-0">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-muted-foreground">
                  <path d="M8 0a5 5 0 0 1 5 5 5 5 0 0 1-5 5A5 5 0 0 1 3 5a5 5 0 0 1 5-5zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm4.5 9.25.884.883a.75.75 0 0 1-1.06 1.061l-.884-.883-.884.883a.75.75 0 0 1-1.06-1.06l.883-.884-.883-.884a.75.75 0 0 1 1.06-1.06l.884.883.884-.883a.75.75 0 0 1 1.06 1.06l-.883.884z"/>
                </svg>
                <span className="text-sm font-semibold text-foreground">Model settings</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-accent/50"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.749.749 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.749.749 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-1 min-h-0">
              {/* Provider list */}
              <div className="w-44 flex-shrink-0 border-r border-border/60 overflow-y-auto bg-muted/20">
                <div className="p-1.5 space-y-0.5">
                  {PROVIDERS.map(p => {
                    const isActive = selectedProvider === p.id;
                    const isConfigured = config.provider === p.id;
                    const isConnected = connectedProviders.has(p.id) || (isConfigured && config.useProxy);
                    return (
                      <button
                        key={p.id}
                        onClick={() => setSelectedProvider(p.id)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors text-xs',
                          isActive
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                        )}
                      >
                        <ProviderDot provider={p.id} size={7} />
                        <span className="flex-1 truncate font-medium">{p.label}</span>
                        {isConnected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" title="Connected" />
                        )}
                        {isConfigured && !isConnected && (
                          <svg width="7" height="7" viewBox="0 0 16 16" fill="currentColor" className="text-primary flex-shrink-0">
                            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.749.749 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right panel */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Provider info */}
                <div className="px-4 pt-3 pb-2 border-b border-border/40 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <ProviderDot provider={focusedProvider.id} size={9} />
                    <span className="font-semibold text-sm text-foreground">{focusedProvider.label}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/50 ml-auto">
                      {focusedProvider.apiKeyEnvHint}
                    </span>
                  </div>
                </div>

                {/* Models */}
                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
                  {focusedProvider.models.map(model => {
                    const isSelected = config.provider === focusedProvider.id && config.model === model.id;
                    return (
                      <button
                        key={model.id}
                        onClick={() => handleSelect(focusedProvider.id as AIProviderId, model.id)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all border',
                          isSelected
                            ? 'bg-primary/10 border-primary/30 text-foreground'
                            : 'border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground hover:border-border/40',
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium leading-tight">{model.label}</span>
                            {isSelected && (
                              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" className="text-primary flex-shrink-0">
                                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.749.749 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                              </svg>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground/50 mt-0.5 truncate">{model.id}</div>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <div className="text-[10px] font-mono text-muted-foreground/60">
                            {fmtCtx(model.contextWindow)} ctx
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* API key + test — only show for currently configured provider */}
                {config.provider === focusedProvider.id && (
                  <div className="flex-shrink-0 border-t border-border/40 px-4 py-3 space-y-2.5">
                    {/* API key row */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 relative">
                        <input
                          type={showKey ? 'text' : 'password'}
                          placeholder={`${focusedProvider.apiKeyEnvHint} — or use proxy`}
                          value={apiKey ?? ''}
                          onChange={e => onApiKeyChange?.(e.target.value)}
                          className="w-full bg-background border border-border/60 rounded-lg px-2.5 py-1.5 pr-8
                                     text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40
                                     focus:outline-none focus:border-primary/50 transition-colors"
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey(s => !s)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                          title={showKey ? 'Hide key' : 'Show key'}
                        >
                          {showKey ? (
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M.143 2.31a.75.75 0 0 1 1.047-.166l14.5 10.5a.75.75 0 1 1-.88 1.212l-14.5-10.5A.75.75 0 0 1 .143 2.31zm3.591 4.052a.75.75 0 0 1-.334 1.006A3.505 3.505 0 0 0 1.5 11c0 1.93 1.57 3.5 3.5 3.5h7a3.5 3.5 0 0 0 0-7H3.5a.75.75 0 0 1 0-1.5h8.5a5 5 0 0 1 0 10h-7A5 5 0 0 1 0 11c0-2.098 1.292-3.9 3.14-4.638a.75.75 0 0 1 .594.001z"/>
                            </svg>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.671 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.329 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.825 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"/>
                            </svg>
                          )}
                        </button>
                      </div>
                      {apiKey && (
                        <span className="text-[10px] text-green-500/80 flex-shrink-0">✓ key set</span>
                      )}
                    </div>

                    {/* Proxy + test row */}
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={config.useProxy}
                          onChange={e => onChange({ useProxy: e.target.checked })}
                          className="w-3 h-3 rounded accent-primary"
                        />
                        <span className="text-[11px] text-muted-foreground">Use server proxy</span>
                      </label>

                      <div className="flex items-center gap-2 ml-auto">
                        {/* Test result badge */}
                        <AnimatePresence mode="wait">
                          {testState.status !== 'idle' && (
                            <motion.span
                              key={testState.status}
                              initial={{ opacity: 0, x: 4 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -4 }}
                              transition={{ duration: 0.12 }}
                              className={cn(
                                'text-[10px] font-mono flex-shrink-0',
                                testState.status === 'testing' && 'text-muted-foreground',
                                testState.status === 'ok' && 'text-green-500',
                                testState.status === 'error' && 'text-red-400',
                              )}
                              title={testState.error}
                            >
                              {testState.status === 'testing' && 'testing…'}
                              {testState.status === 'ok' && `✓ connected ${testState.latencyMs}ms`}
                              {testState.status === 'error' && `✗ ${testState.error?.slice(0, 40) ?? 'failed'}`}
                            </motion.span>
                          )}
                        </AnimatePresence>

                        {/* Test button */}
                        <button
                          onClick={handleTest}
                          disabled={testState.status === 'testing'}
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all',
                            testState.status === 'testing'
                              ? 'border-border/30 text-muted-foreground/40 cursor-not-allowed'
                              : 'border-border/60 text-foreground hover:bg-accent/60 hover:border-border active:scale-95',
                          )}
                        >
                          {testState.status === 'testing' ? (
                            <svg
                              className="animate-spin"
                              width="10" height="10" viewBox="0 0 24 24"
                              fill="none" stroke="currentColor" strokeWidth="2"
                            >
                              <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round"/>
                            </svg>
                          ) : (
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm3.822-1.814a.5.5 0 0 1 .635-.319l4 1.5a.5.5 0 0 1 0 .932l-4 1.5a.5.5 0 0 1-.319-.949l2.965-1.11-2.965-1.11a.5.5 0 0 1-.316-.444z"/>
                            </svg>
                          )}
                          Test connection
                        </button>
                      </div>
                    </div>

                    <p className="text-[9px] text-muted-foreground/35 leading-relaxed">
                      API key stored in session memory only — never persisted.
                      {config.useProxy ? ' Requests route through the backend proxy.' : ' Requests go directly to the provider.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {/* Trigger pill */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] transition-colors border',
          open
            ? 'bg-accent border-border text-foreground'
            : 'border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/50 hover:border-border',
        )}
      >
        <ProviderDot provider={config.provider} size={6} />
        <span className="font-medium">{currentProvider?.label ?? config.provider}</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="font-mono text-[9px]">{currentModel?.label ?? config.model}</span>
        {/* Connected indicator in the trigger pill */}
        {(connectedProviders.has(config.provider) || config.useProxy) && (
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" title="Connected" />
        )}
        <svg
          width="8" height="8" viewBox="0 0 16 16" fill="currentColor"
          className={cn('text-muted-foreground/40 transition-transform duration-150', open && 'rotate-180')}
        >
          <path d="M4.427 7.427l3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z"/>
        </svg>
      </button>

      {/* Portal modal */}
      {createPortal(modal, document.body)}
    </>
  );
}
