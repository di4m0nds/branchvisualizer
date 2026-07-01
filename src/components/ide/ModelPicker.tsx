import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/store/AppContext';
import { PROVIDERS } from '@/lib/agent/providers';
import type { ProbeResult, ProbeState, Provider } from '@/lib/agent/transport';

// Model picker + probe status panel — the "easy way to verify the IDE is
// actually detecting the models and connected to them" surface. Shows every
// provider with a live status pip + tier badge; click a row to select.

// ─── Pill helpers ────────────────────────────────────────────────────────────

function stateColor(s: ProbeState): string {
  if (s === 'connected') return 'bg-green-400';
  if (s === 'detected') return 'bg-amber-400';
  return 'bg-muted-foreground/40';
}
function tierColor(t?: string): string {
  if (t === 'paid') return 'text-blue-400 border-blue-400/40 bg-blue-400/10';
  if (t === 'free') return 'text-green-400 border-green-400/40 bg-green-400/10';
  return 'text-muted-foreground border-border bg-muted/20';
}
function stateLabel(s: ProbeState): string {
  return s === 'connected' ? 'connected' : s === 'detected' ? 'detected' : 'not detected';
}

// ─── Panel row ───────────────────────────────────────────────────────────────

function ProviderRow({
  provider, status, selected, onSelectModel,
}: {
  provider: Provider;
  status: ProbeResult | null;
  selected: { providerId: string; modelId: string };
  onSelectModel: (providerId: string, modelId: string) => void;
}) {
  const detected = status?.state ?? 'not_detected';
  return (
    <div className="border border-border rounded-md bg-muted/10">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/40">
        <span className={cn('w-1.5 h-1.5 rounded-full', stateColor(detected))} />
        <span className="text-xs font-semibold text-foreground">{provider.label}</span>
        <span className={cn('px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider', tierColor(status?.tier))}>
          {status?.tier ?? 'unknown'}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/70 truncate max-w-64" title={status?.label}>
          {status?.label ?? stateLabel(detected)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 p-1.5">
        {provider.models().map((m) => {
          const isSelected = selected.providerId === provider.id && selected.modelId === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onSelectModel(provider.id, m.id)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono transition-colors',
                isSelected ? 'bg-primary/15 text-primary border border-primary/40'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/30 border border-transparent',
              )}
              title={`${m.id} · ${m.contextTokens?.toLocaleString() ?? '?'} tok context`}
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

export default function ModelPicker() {
  const { state, dispatch } = useAppContext();
  const [open, setOpen] = useState(false);
  const [probing, setProbing] = useState(false);

  const selected = state.currentModel;
  const activeProvider = useMemo(() => PROVIDERS.find((p) => p.id === selected.providerId), [selected.providerId]);
  const activeModel = activeProvider?.models().find((m) => m.id === selected.modelId);
  const activeStatus = state.providerStatus[selected.providerId] as ProbeResult | undefined;

  const runProbes = async () => {
    setProbing(true);
    try {
      const results = await Promise.all(
        PROVIDERS.map(async (p) => [p.id, await p.probe().catch((e: unknown) => ({
          state: 'not_detected' as ProbeState, tier: 'unknown' as const,
          label: e instanceof Error ? e.message : 'probe failed',
        }))] as const),
      );
      for (const [id, status] of results) {
        dispatch({ type: 'SET_PROVIDER_STATUS', providerId: id, status });
      }
    } finally {
      setProbing(false);
    }
  };

  // Probe once on mount so the trigger label reflects reality without a click.
  useEffect(() => {
    if (Object.keys(state.providerStatus).length === 0) void runProbes();
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
        <span>{activeModel?.label ?? selected.modelId}</span>
        <span className={cn('ml-1 px-1 py-0 rounded border text-[9px] uppercase tracking-wider', tierColor(activeStatus?.tier))}>
          {activeStatus?.tier ?? '?'}
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
                  status={(state.providerStatus[p.id] ?? null) as ProbeResult | null}
                  selected={selected}
                  onSelectModel={(providerId, modelId) => {
                    dispatch({ type: 'SET_MODEL', model: { providerId, modelId } });
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
