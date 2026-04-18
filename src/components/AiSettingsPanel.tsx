// apps/branchvisualizer/src/components/AiSettingsPanel.tsx
// AI provider/model/key settings — draggable floating panel.
// Includes per-provider connection testing + status indicators.

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { AIConfig, AIProviderId } from '@/hooks/useAi';

// ─── Provider / model catalogue ───────────────────────────────────────────────

interface ModelDef { id: string; label: string; }
interface ProviderDef {
  id: AIProviderId;
  label: string;
  hint: string;
  docsUrl: string;
  freeNote?: string;
  models: ModelDef[];
}

const PROVIDERS: ProviderDef[] = [
  {
    id: 'groq',
    label: 'Groq',
    hint: 'gsk_…',
    docsUrl: 'https://console.groq.com/keys',
    freeNote: 'Free — no billing',
    models: [
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
      { id: 'gemma2-9b-it',         label: 'Gemma 2 9B' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    hint: 'sk-ant-…',
    docsUrl: 'https://console.anthropic.com',
    models: [
      { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5 (fast)' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (balanced)' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'sk-…',
    docsUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini (fast)' },
      { id: 'gpt-4o',      label: 'GPT-4o (balanced)' },
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    hint: 'AIza…',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    freeNote: 'Free (personal account)',
    models: [
      { id: 'gemini-2.0-flash',  label: 'Gemini 2.0 Flash (fast)' },
      { id: 'gemini-1.5-flash',  label: 'Gemini 1.5 Flash (fast)' },
      { id: 'gemini-1.5-pro',    label: 'Gemini 1.5 Pro (balanced)' },
    ],
  },
];

// ─── Connection status ────────────────────────────────────────────────────────

type ConnStatus = 'idle' | 'testing' | 'ok' | 'error';

const SS_CONN_PREFIX = 'ca_ai_conn_';
function loadConnStatus(provider: AIProviderId): ConnStatus {
  try {
    const v = sessionStorage.getItem(SS_CONN_PREFIX + provider);
    return (v === 'ok' || v === 'error') ? v : 'idle';
  } catch { return 'idle'; }
}
function saveConnStatus(provider: AIProviderId, status: ConnStatus) {
  try {
    if (status === 'ok' || status === 'error') {
      sessionStorage.setItem(SS_CONN_PREFIX + provider, status);
    } else {
      sessionStorage.removeItem(SS_CONN_PREFIX + provider);
    }
  } catch { /* ignore */ }
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const SS_PREFIX = 'ca_ai_key_';
function loadKey(provider: AIProviderId): string {
  try { return sessionStorage.getItem(SS_PREFIX + provider) ?? ''; } catch { return ''; }
}
function saveKey(provider: AIProviderId, key: string) {
  try {
    if (key) sessionStorage.setItem(SS_PREFIX + provider, key);
    else sessionStorage.removeItem(SS_PREFIX + provider);
  } catch { /* ignore */ }
}

// ─── Connection test ──────────────────────────────────────────────────────────
// Uses the cheapest available endpoint per provider to verify the key.
// Gemini: models list (free). OpenAI: models list (free). Anthropic: models list (free).

// Extracts a short readable message from a provider error response.
async function providerErrMsg(provider: AIProviderId, status: number, res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  let apiMsg = '';
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    const raw = j.error?.message ?? '';
    apiMsg = raw
      .split('\n')[0]
      .split('*')[0]
      .replace(/\. For more.*$/i, '.')
      .replace(/\. To monitor.*$/i, '.')
      .trim()
      .slice(0, 100);
  } catch { /* not JSON */ }

  const hint =
    status === 401 ? 'Invalid API key.' :
    status === 403 ? 'Key lacks required permissions.' :
    status === 429 && provider === 'gemini'
      ? 'Enable billing at console.cloud.google.com/billing to unlock the free quota tier.'
      : status === 429 ? 'Rate limited — wait a moment.' :
    status === 404 ? 'Resource not found.' : '';

  return [apiMsg || `HTTP ${status}`, hint].filter(Boolean).join(' — ');
}

async function pingProvider(provider: AIProviderId, key: string): Promise<void> {
  switch (provider) {
    case 'groq': {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(await providerErrMsg(provider, res.status, res));
      break;
    }
    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
      if (!res.ok) throw new Error(await providerErrMsg(provider, res.status, res));
      break;
    }
    case 'openai': {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(await providerErrMsg(provider, res.status, res));
      break;
    }
    case 'gemini': {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await providerErrMsg(provider, res.status, res));
      break;
    }
  }
}

// ─── Status dot ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ConnStatus }) {
  if (status === 'idle') return null;
  if (status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        Testing…
      </span>
    );
  }
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-red-500 font-medium">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      Failed
    </span>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AiSettingsPanelProps {
  config: AIConfig;
  onChange: (config: AIConfig) => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AiSettingsPanel({ config, onChange, onClose }: AiSettingsPanelProps) {
  const [pos, setPos] = useState({ x: 80, y: 80 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Form state
  const [provider, setProvider] = useState<AIProviderId>(config.provider);
  const [model, setModel] = useState(config.model);
  const [apiKey, setApiKey] = useState(() => loadKey(config.provider));
  const [useProxy, setUseProxy] = useState(config.useProxy);
  const [showKey, setShowKey] = useState(false);

  // Per-provider connection status (loaded from sessionStorage)
  const [connStatuses, setConnStatuses] = useState<Record<AIProviderId, ConnStatus>>(() => ({
    groq: loadConnStatus('groq'),
    anthropic: loadConnStatus('anthropic'),
    openai: loadConnStatus('openai'),
    gemini: loadConnStatus('gemini'),
  }));
  const [connError, setConnError] = useState('');

  const currentProvider = PROVIDERS.find(p => p.id === provider) ?? PROVIDERS[0];
  const currentStatus = connStatuses[provider];

  // When provider changes, load stored key + default to first model; reset error
  const handleProviderChange = useCallback((p: AIProviderId) => {
    setProvider(p);
    setApiKey(loadKey(p));
    setConnError('');
    const def = PROVIDERS.find(x => x.id === p);
    if (def) setModel(def.models[0].id);
  }, []);

  // When key changes, reset this provider's status
  const handleKeyChange = useCallback((val: string) => {
    setApiKey(val);
    setConnError('');
    setConnStatuses(s => ({ ...s, [provider]: 'idle' }));
    saveConnStatus(provider, 'idle');
  }, [provider]);

  // Test the current key
  const handleTest = useCallback(async () => {
    if (!apiKey.trim()) return;
    setConnStatuses(s => ({ ...s, [provider]: 'testing' }));
    setConnError('');
    try {
      await pingProvider(provider, apiKey.trim());
      setConnStatuses(s => ({ ...s, [provider]: 'ok' }));
      saveConnStatus(provider, 'ok');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setConnStatuses(s => ({ ...s, [provider]: 'error' }));
      saveConnStatus(provider, 'error');
      setConnError(msg);
    }
  }, [provider, apiKey]);

  // Drag handling
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  const handleSave = () => {
    saveKey(provider, apiKey);
    onChange({ provider, model, apiKey: apiKey || undefined, useProxy });
    onClose();
  };

  // Count how many providers are connected
  const connectedCount = Object.values(connStatuses).filter(s => s === 'ok').length;

  return createPortal(
    <div
      className={cn(
        'fixed z-[200] w-[340px] rounded-xl border border-border bg-popover shadow-2xl',
        'flex flex-col overflow-hidden',
        dragging ? 'select-none cursor-grabbing' : '',
      )}
      style={{ left: pos.x, top: pos.y }}
    >
      {/* ── Header / drag handle ── */}
      <div
        onMouseDown={onMouseDown}
        className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-muted/30 cursor-grab select-none"
      >
        <div className="flex items-center gap-2">
          {/* Gear icon */}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-muted-foreground shrink-0">
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.5-1.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5Z"/>
          </svg>
          <span className="text-xs font-semibold text-foreground">AI Settings</span>
          {connectedCount > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[10px] font-medium">
              <span className="w-1 h-1 rounded-full bg-emerald-500" />
              {connectedCount} connected
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.749.749 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.749.749 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
          </svg>
        </button>
      </div>

      {/* ── Provider status overview bar ── */}
      <div className="flex items-center gap-1 px-3 py-2 bg-muted/10 border-b border-border/50">
        {PROVIDERS.map(p => {
          const s = connStatuses[p.id];
          return (
            <button
              key={p.id}
              onClick={() => handleProviderChange(p.id)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors',
                provider === p.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              )}
            >
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                s === 'ok'      ? 'bg-emerald-500' :
                s === 'error'   ? 'bg-red-500' :
                s === 'testing' ? 'bg-amber-400 animate-pulse' :
                                  'bg-muted-foreground/30',
              )} />
              {p.label}
            </button>
          );
        })}
      </div>

      {/* ── Body ── */}
      <div className="flex flex-col gap-3 p-3">

        {/* Provider details row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">{currentProvider.label}</span>
            <StatusDot status={currentStatus} />
          </div>
          <a
            href={currentProvider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[10px] text-primary hover:underline"
          >
            {currentProvider.freeNote
              ? <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium">{currentProvider.freeNote}</span>
              : 'Get API key'
            }
            <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" className="opacity-70">
              <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/>
            </svg>
          </a>
        </div>

        {/* Model selector */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Model</label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full text-xs bg-background border border-border rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {currentProvider.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>

        {/* API Key (only when not using proxy) */}
        {!useProxy && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">API Key</label>

            {/* Key input row */}
            <div className="flex items-center gap-1">
              <div className={cn(
                'flex flex-1 items-center rounded-md border transition-colors',
                currentStatus === 'ok'    ? 'border-emerald-500/60 bg-emerald-500/5' :
                currentStatus === 'error' ? 'border-red-500/60 bg-red-500/5' :
                                            'border-border bg-background',
              )}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => handleKeyChange(e.target.value)}
                  placeholder={currentProvider.hint}
                  className="flex-1 text-xs bg-transparent px-2 py-1.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none font-mono min-w-0"
                />
                {/* Show/hide toggle */}
                <button
                  onClick={() => setShowKey(s => !s)}
                  className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey
                    ? <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M.143 2.31a.75.75 0 0 1 1.047-.167l14.5 10.5a.75.75 0 1 1-.88 1.214l-2.248-1.628C11.346 12.769 9.792 13 8 13c-3.675 0-6.4-1.977-7.608-3.514a1.76 1.76 0 0 1 0-2.093c.468-.598 1.101-1.197 1.908-1.7L.31 3.357A.75.75 0 0 1 .143 2.31ZM8 5.5c.818 0 1.578.22 2.212.598l-4.114-2.977A5.494 5.494 0 0 0 8 5.5Z"/><path d="M12.828 12.11 11.1 10.874a3.5 3.5 0 0 0-4.974-4.974L4.71 4.712a5.5 5.5 0 0 1 7.79 7.79 5.49 5.49 0 0 1-.672-.392Z"/></svg>
                    : <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.824-.742 3.955-1.715 1.125-.967 1.955-2.095 2.366-2.717a.12.12 0 0 0 0-.136c-.411-.622-1.241-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.824.742-3.955 1.715-1.125.967-1.955 2.095-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"/></svg>
                  }
                </button>
              </div>

              {/* Test button */}
              <button
                onClick={handleTest}
                disabled={!apiKey.trim() || currentStatus === 'testing'}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors shrink-0',
                  'border disabled:opacity-40 disabled:cursor-not-allowed',
                  currentStatus === 'ok'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : currentStatus === 'error'
                    ? 'border-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/15'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
                title="Test connection to this provider"
              >
                {currentStatus === 'testing' ? (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="animate-spin">
                    <path d="M8 0a8 8 0 1 0 8 8A8.009 8.009 0 0 0 8 0Zm0 14.5A6.5 6.5 0 1 1 14.5 8 6.507 6.507 0 0 1 8 14.5Z" opacity=".3"/>
                    <path d="M8 1.5A6.5 6.5 0 0 1 14.5 8h1.5A8 8 0 0 0 8 0Z"/>
                  </svg>
                ) : currentStatus === 'ok' ? (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm.25 4.75a.75.75 0 0 0-1.5 0v4a.75.75 0 0 0 1.5 0ZM8 11.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/>
                  </svg>
                )}
                {currentStatus === 'ok' ? 'OK' : currentStatus === 'testing' ? '' : 'Test'}
              </button>
            </div>

            {/* Status feedback */}
            {currentStatus === 'ok' && (
              <p className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
                </svg>
                Key verified — ready to use
              </p>
            )}
            {currentStatus === 'error' && connError && (
              <p className="text-[10px] text-red-500 leading-snug">
                {connError.length > 80 ? connError.slice(0, 80) + '…' : connError}
              </p>
            )}
            {currentStatus === 'idle' && (
              <p className="text-[10px] text-muted-foreground/50">
                Stored in sessionStorage only — cleared when you close the tab.
              </p>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-border/50" />
        </div>

        {/* Backend proxy toggle */}
        <label className="flex items-center justify-between gap-2 cursor-pointer group">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-foreground group-hover:text-foreground transition-colors">Use backend proxy</span>
            <span className="text-[10px] text-muted-foreground/50">API key configured server-side</span>
          </div>
          <div
            onClick={() => setUseProxy(v => !v)}
            className={cn(
              'relative w-8 h-4 rounded-full transition-colors shrink-0',
              useProxy ? 'bg-primary' : 'bg-muted',
            )}
          >
            <div className={cn(
              'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform',
              useProxy ? 'translate-x-4' : 'translate-x-0.5',
            )} />
          </div>
        </label>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-t border-border bg-muted/20">
        <span className="text-[10px] text-muted-foreground/40 font-mono truncate max-w-[140px]">
          {apiKey && !showKey ? `${apiKey.slice(0, 8)}${'·'.repeat(Math.min(8, apiKey.length - 8))}` : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
