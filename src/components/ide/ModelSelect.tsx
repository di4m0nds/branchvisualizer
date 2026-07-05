import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAppState, useAppSelector } from '@/store/store';
import { useSessionModel } from '@/hooks/useSessionModel';
import { PROVIDERS, findProvider } from '@/lib/agent/providers';
import { probeAllProviders } from '@/lib/agent/providers/probe';
import type { ContextSizeId, ProbeResult, Provider } from '@/lib/agent/transport';

// ─── Compact model selector ──────────────────────────────────────────────────
// Selection ONLY: pick a provider → pick a model (+ context size). Fixed-width
// popover that flips upward near the bottom edge. Configured providers list
// first; unconfigured ones collapse under "Not configured" with a pointer to
// Settings → Providers (where diagnostics + key management live).

const PANEL_W = 280;
const PANEL_MAX_H = 380;

function stateRank(s?: ProbeResult): number {
  return s?.state === 'connected' ? 0 : s?.state === 'detected' ? 1 : 2;
}

function Pip({ status }: { status?: ProbeResult }) {
  const color = status?.state === 'connected' ? 'bg-green-500'
    : status?.state === 'detected' ? 'bg-amber-500'
    : 'bg-muted-foreground/40';
  return <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', color)} />;
}

export default function ModelSelect() {
  // Session-scoped: with an active session this reads/writes THAT session's
  // model config; other sessions are untouched.
  const { selected: current, setModel } = useSessionModel();
  const providerStatus = useAppSelector((s) => s.providerStatus);
  const servedModels = useAppSelector((s) => s.servedModels);

  const [open, setOpen] = useState(false);
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [showUnconfigured, setShowUnconfigured] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [probing, setProbing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const provider = findProvider(current.providerId);
  const model = provider?.models().find((m) => m.id === current.modelId);
  const served = servedModels[`${current.providerId}:${current.modelId}`];
  const currentStatus = providerStatus[current.providerId];

  // Probe all providers when first opened with an empty status map.
  useEffect(() => {
    if (!open || Object.keys(getAppState().providerStatus).length > 0) return;
    void probeAll();
  }, [open]);

  async function probeAll() {
    setProbing(true);
    await probeAllProviders();
    setProbing(false);
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = () => {
    if (!open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setDropUp(window.innerHeight - rect.bottom < PANEL_MAX_H + 16);
      setOpenProvider(current.providerId);
      setShowUnconfigured(false);
    }
    setOpen((v) => !v);
  };

  const { configured, unconfigured } = useMemo(() => {
    const ranked = [...PROVIDERS].sort((a, b) => stateRank(providerStatus[a.id]) - stateRank(providerStatus[b.id]));
    return {
      configured: ranked.filter((p) => stateRank(providerStatus[p.id]) < 2),
      unconfigured: ranked.filter((p) => stateRank(providerStatus[p.id]) === 2),
    };
  }, [providerStatus]);

  // Context size is chosen separately (ContextSelect). Picking a model keeps
  // the current context only when the new model still offers it, else standard.
  const pick = (p: Provider, modelId: string) => {
    const opts = p.models().find((m) => m.id === modelId)?.contextOptions ?? [];
    const keep = current.context && opts.some((o) => o.id === current.context);
    setModel({ providerId: p.id, modelId, context: keep ? current.context : 'standard' });
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      {/* Trigger chip */}
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-muted/30 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors max-w-[260px]"
        title={served ? `serving ${served}` : undefined}
      >
        <Pip status={currentStatus} />
        <span className="truncate">{provider?.label ?? current.providerId}</span>
        <span className="text-foreground/80 truncate">{model?.label ?? current.modelId}</span>
        {current.context === '1m' && (
          <span className="px-1 rounded bg-primary/15 text-primary text-[8px] font-semibold">1M</span>
        )}
        <ChevronDown className="w-3 h-3 flex-shrink-0" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute right-0 z-50 rounded-lg border border-border bg-popover shadow-xl overflow-y-auto',
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
          style={{ width: PANEL_W, maxHeight: PANEL_MAX_H }}
        >
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border sticky top-0 bg-popover">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Model</span>
            <button
              onClick={() => void probeAll()}
              disabled={probing}
              className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Re-probe providers"
            >
              <RefreshCw className={cn('w-3 h-3', probing && 'animate-spin')} />
            </button>
          </div>

          {configured.length === 0 && (
            <p className="px-2.5 py-2 text-[10px] text-muted-foreground">
              No providers detected — add keys in Settings → Providers.
            </p>
          )}

          {configured.map((p) => (
            <ProviderGroup
              key={p.id}
              provider={p}
              status={providerStatus[p.id]}
              expanded={openProvider === p.id}
              onToggle={() => setOpenProvider((cur) => (cur === p.id ? null : p.id))}
              current={current}
              onPick={pick}
            />
          ))}

          {unconfigured.length > 0 && (
            <div className="border-t border-border/60">
              <button
                onClick={() => setShowUnconfigured((v) => !v)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-muted-foreground/70 hover:text-foreground"
              >
                <ChevronDown className={cn('w-3 h-3 transition-transform', !showUnconfigured && '-rotate-90')} />
                Not configured ({unconfigured.length}) — set up in Settings → Providers
              </button>
              {showUnconfigured && unconfigured.map((p) => (
                <ProviderGroup
                  key={p.id}
                  provider={p}
                  status={providerStatus[p.id]}
                  expanded={openProvider === p.id}
                  onToggle={() => setOpenProvider((cur) => (cur === p.id ? null : p.id))}
                  current={current}
                  onPick={pick}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProviderGroup({ provider, status, expanded, onToggle, current, onPick }: {
  provider: Provider;
  status?: ProbeResult;
  expanded: boolean;
  onToggle: () => void;
  current: { providerId: string; modelId: string; context?: ContextSizeId };
  onPick: (p: Provider, modelId: string) => void;
}) {
  return (
    <div className="border-b border-border/40 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] hover:bg-accent/30 transition-colors"
      >
        <Pip status={status} />
        <span className={cn('font-medium', current.providerId === provider.id ? 'text-foreground' : 'text-muted-foreground')}>
          {provider.label}
        </span>
        {status?.tier && status.tier !== 'unknown' && (
          <span className="px-1 rounded bg-muted text-[8px] uppercase text-muted-foreground">{status.tier}</span>
        )}
        <ChevronDown className={cn('w-3 h-3 ml-auto text-muted-foreground transition-transform', !expanded && '-rotate-90')} />
      </button>
      {expanded && (
        <div className="pb-1">
          {provider.models().map((m) => {
            const active = current.providerId === provider.id && current.modelId === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onPick(provider, m.id)}
                className={cn(
                  'w-full text-left px-2.5 py-1 pl-6 text-[11px] transition-colors',
                  active ? 'text-primary bg-primary/10' : 'text-foreground/80 hover:bg-accent/30',
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
