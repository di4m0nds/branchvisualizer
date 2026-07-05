import { useEffect, useMemo, useState } from 'react';
import { KeyRound, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppSelector, useAppDispatch } from '@/store/store';
import { useSessionModel } from '@/hooks/useSessionModel';
import { PROVIDERS, findProvider } from '@/lib/agent/providers';
import { probeAllProviders } from '@/lib/agent/providers/probe';
import { setProviderKey } from '@/lib/providerKeys';
import type { ContextSizeId, ProbeResult, ProbeState, Provider } from '@/lib/agent/transport';
import { AUTH_KIND, stateColor, tierColor, stateLabel, shortModel } from '@/lib/agent/providerPresentation';

// Providers whose key can be pasted in manually (env/CLI-authed ones excluded
// from needing it, but all accept a manual override).
const KEY_PROVIDER_ID: Record<string, string> = {
  anthropic: 'anthropic',
  openai_codex: 'openai',
  gemini: 'gemini',
  antigravity: 'antigravity',
  minimax: 'minimax',
  openrouter: 'openrouter',
  xai: 'xai',
  deepseek: 'deepseek',
};

// Model picker + probe status panel — the "easy way to verify the IDE is
// actually detecting the models and connected to them" surface. Shows every
// provider with a live status pip + tier badge; click a row to select.

// ─── Panel row ───────────────────────────────────────────────────────────────

function ProviderRow({
  provider, status, selected, onSelectModel, onSaveKey, onRetry,
}: {
  provider: Provider;
  status: ProbeResult | null;
  selected: { providerId: string; modelId: string; context?: ContextSizeId };
  onSelectModel: (providerId: string, modelId: string) => void;
  onSaveKey: (providerId: string, key: string) => Promise<void>;
  onRetry: (providerId: string) => Promise<void>;
}) {
  const detected = status?.state ?? 'not_detected';
  const keyProvider = KEY_PROVIDER_ID[provider.id];
  const auth = AUTH_KIND[provider.id];
  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // A failed-but-keyed probe carries the underlying error; surface it inline
  // (not just in the title tooltip) so the failure is diagnosable at a glance.
  const statusText = status?.error
    ? `${status.label ?? stateLabel(detected)} — ${status.error}`
    : status?.label ?? stateLabel(detected);

  const retry = async () => {
    setRetrying(true);
    try { await onRetry(provider.id); } finally { setRetrying(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSaveKey(keyProvider, keyInput.trim());
      setKeyInput('');
      setShowKey(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-border rounded-md bg-muted/10">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/40">
        <span className={cn('w-1.5 h-1.5 rounded-full', stateColor(detected))} />
        <span className="text-xs font-semibold text-foreground">{provider.label}</span>
        {auth && (
          <span className={cn('px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider', auth.tone)}>
            {auth.badge}
          </span>
        )}
        <span className={cn('px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider', tierColor(status?.tier))}>
          {status?.tier ?? 'unknown'}
        </span>
        <span
          className={cn('text-[10px] truncate max-w-52 flex-1',
            status?.error ? 'text-amber-400/90' : 'text-muted-foreground/70')}
          title={statusText}
        >
          {statusText}
        </span>
        <button
          onClick={retry}
          disabled={retrying}
          className="flex items-center justify-center h-5 w-5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Re-check this provider"
        >
          <RotateCw className={cn('w-3 h-3', retrying && 'animate-spin')} />
        </button>
        {keyProvider && (
          <button
            onClick={() => setShowKey((v) => !v)}
            className={cn('flex items-center justify-center h-5 w-5 rounded border transition-colors',
              showKey ? 'border-primary/40 text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground')}
            title="Enter API token manually"
          >
            <KeyRound className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="px-2.5 py-1 text-[10px] text-muted-foreground/60 border-b border-border/40">
        {auth ? auth.blurb : provider.description}
      </div>
      {showKey && keyProvider && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border/40 bg-background/40">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
            placeholder={`Paste ${provider.label} API key`}
            className="flex-1 min-w-0 px-2 py-1 rounded border border-border bg-background text-[11px] font-mono focus:outline-none focus:border-primary/50"
            autoFocus
          />
          <button
            onClick={save}
            disabled={saving || !keyInput.trim()}
            className="px-2 py-1 rounded text-[10px] font-mono border border-border hover:bg-accent/40 disabled:opacity-50"
          >
            {saving ? 'saving…' : 'save'}
          </button>
        </div>
      )}
      <div className="flex flex-col gap-1 p-1.5">
        {provider.models().map((m) => {
          const isSelected = selected.providerId === provider.id && selected.modelId === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onSelectModel(provider.id, m.id)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono transition-colors text-left',
                isSelected ? 'bg-primary/15 text-primary border border-primary/40'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/30 border border-transparent',
              )}
              title={`${m.id} · ${(m.contextTokens ?? 0).toLocaleString()} tok standard context`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main picker ─────────────────────────────────────────────────────────────

export default function ModelPicker({ scope = 'auto' }: { scope?: 'auto' | 'global' } = {}) {
  const dispatch = useAppDispatch();
  // Session-scoped by default: with an active session this reads/writes THAT
  // session's model config; other sessions are untouched. Settings surfaces
  // pass scope="global" to edit the new-session default instead.
  const { selected, setModel } = useSessionModel(scope);
  const providerStatus = useAppSelector((s) => s.providerStatus);
  const servedModels = useAppSelector((s) => s.servedModels);
  const [open, setOpen] = useState(false);
  const [probing, setProbing] = useState(false);
  const activeProvider = useMemo(() => PROVIDERS.find((p) => p.id === selected.providerId), [selected.providerId]);
  const activeModel = activeProvider?.models().find((m) => m.id === selected.modelId);
  const activeStatus = providerStatus[selected.providerId] as ProbeResult | undefined;
  const ctxId: ContextSizeId = selected.context ?? 'standard';
  // Prefer the model the provider actually served (from the last turn) over the
  // requested one, so the chip reflects what really ran.
  const served = servedModels[`${selected.providerId}:${selected.modelId}`];
  const chipLabel = served ? shortModel(served) : (activeModel?.label ?? selected.modelId);

  const probeOne = async (providerId: string) => {
    const p = PROVIDERS.find((x) => x.id === providerId);
    if (!p) return;
    const status = await p.probe().catch((e: unknown) => ({
      state: 'not_detected' as ProbeState, tier: 'unknown' as const,
      label: e instanceof Error ? e.message : 'probe failed',
    }));
    dispatch({ type: 'SET_PROVIDER_STATUS', providerId, status });
  };

  const runProbes = async () => {
    setProbing(true);
    try {
      await probeAllProviders();
    } finally {
      setProbing(false);
    }
  };

  // Save a manually-entered key, then re-probe the matching provider so its
  // status pill flips to connected without a manual refresh.
  const saveKey = async (keyProviderName: string, key: string) => {
    await setProviderKey(keyProviderName, key);
    const providerId = Object.keys(KEY_PROVIDER_ID).find((id) => KEY_PROVIDER_ID[id] === keyProviderName);
    if (providerId) await probeOne(providerId);
  };

  // Probe once on mount so the trigger label reflects reality without a click.
  useEffect(() => {
    if (Object.keys(providerStatus).length === 0) void runProbes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono transition-colors',
          'border-border bg-muted/20 hover:bg-accent/40 text-foreground',
        )}
        title="Change model"
      >
        <span className={cn('w-1.5 h-1.5 rounded-full', stateColor(activeStatus?.state ?? 'not_detected'))} />
        <span>{activeProvider?.label ?? '?'}</span>
        <span className="opacity-60">·</span>
        <span title={served ? `served: ${served}` : undefined}>{chipLabel}</span>
        <span className={cn('ml-1 px-1 py-0 rounded border text-[9px] uppercase tracking-wider', tierColor(activeStatus?.tier))}>
          {activeStatus?.tier ?? '?'}
        </span>
        <span
          className={cn('px-1 py-0 rounded border text-[9px] uppercase tracking-wider',
            ctxId === '1m' ? 'text-amber-400 border-amber-400/40 bg-amber-400/10' : 'text-muted-foreground border-border')}
          title={ctxId === '1m' ? '1M context' : 'Standard 200K context'}
        >
          {ctxId === '1m' ? '1M' : 'STD'}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-[380px] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-popover shadow-xl">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Model</span>
              <button
                onClick={runProbes}
                disabled={probing}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border hover:bg-accent/40 disabled:opacity-50"
              >
                {probing ? 'probing…' : 'refresh'}
              </button>
            </div>
            <div className="p-2 space-y-2">
              {PROVIDERS.map((p) => (
                <ProviderRow
                  key={p.id}
                  provider={p}
                  status={(providerStatus[p.id] ?? null) as ProbeResult | null}
                  selected={selected}
                  onSaveKey={saveKey}
                  onRetry={probeOne}
                  onSelectModel={(providerId, modelId) => {
                    // Context size is chosen via the dedicated ContextSelect;
                    // keep the current context only when the new model offers it.
                    const opts = findProvider(providerId)?.models().find((mm) => mm.id === modelId)?.contextOptions ?? [];
                    const keep = selected.context && opts.some((o) => o.id === selected.context);
                    setModel({ providerId, modelId, context: keep ? selected.context : 'standard' });
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
