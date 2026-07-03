import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RotateCw, Loader2, Check, AlertTriangle, ArrowUpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/store/AppContext';
import { invoke } from '@/lib/platform';
import { PROVIDERS } from '@/lib/agent/providers';
import type { ProbeResult, ProbeState } from '@/lib/agent/transport';
import { AUTH_KIND, stateColor, tierColor, stateLabel } from '@/lib/agent/providerPresentation';
import ModelPicker from '@/components/ide/ModelPicker';

// Providers whose local toolchain can self-update via a Rust command
// (allow-listed in src-tauri: `provider_update`). Label is what the button runs.
const UPDATABLE: Record<string, string> = {
  claude_code: 'claude update',
  antigravity: 'pip install -U google-antigravity',
};

interface UpdateResult { ok: boolean; output: string; command: string }
type UpdatePhase = 'idle' | 'running' | 'done' | 'error';
interface UpdateState { phase: UpdatePhase; result?: UpdateResult; error?: string }

// ─── Animated update button ──────────────────────────────────────────────────

function UpdateButton({ providerId, cmd, onDone }: {
  providerId: string;
  cmd: string;
  onDone: (r: UpdateState) => void;
}) {
  const [phase, setPhase] = useState<UpdatePhase>('idle');

  const run = async () => {
    if (phase === 'running') return;
    setPhase('running');
    try {
      const r = await invoke<UpdateResult>('provider_update', { name: providerId });
      setPhase(r.ok ? 'done' : 'error');
      onDone({ phase: r.ok ? 'done' : 'error', result: r });
    } catch (e) {
      setPhase('error');
      onDone({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      // Settle the button back to idle after the success/error flourish.
      setTimeout(() => setPhase('idle'), 2600);
    }
  };

  return (
    <button
      onClick={run}
      disabled={phase === 'running'}
      title={`Run: ${cmd}`}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono transition-colors',
        phase === 'done' ? 'border-green-400/40 text-green-400 bg-green-400/10'
          : phase === 'error' ? 'border-red-400/40 text-red-400 bg-red-400/10'
          : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40',
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'running' ? (
          <motion.span key="run" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> updating…
          </motion.span>
        ) : phase === 'done' ? (
          <motion.span key="done" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
            <Check className="w-3 h-3" /> updated
          </motion.span>
        ) : phase === 'error' ? (
          <motion.span key="err" initial={{ x: -2, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> failed
          </motion.span>
        ) : (
          <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
            <ArrowUpCircle className="w-3 h-3" /> update
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

// ─── Provider card ───────────────────────────────────────────────────────────

function ProviderCard({ providerId, label, description, status, retrying, onRetry }: {
  providerId: string;
  label: string;
  description: string;
  status: ProbeResult | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  const detected: ProbeState = status?.state ?? 'not_detected';
  const auth = AUTH_KIND[providerId];
  const updateCmd = UPDATABLE[providerId];
  const [update, setUpdate] = useState<UpdateState>({ phase: 'idle' });

  const statusText = status?.error
    ? `${status.label ?? stateLabel(detected)} — ${status.error}`
    : status?.label ?? stateLabel(detected);

  return (
    <div className="rounded-lg border border-border bg-muted/10">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={cn('w-2 h-2 rounded-full', stateColor(detected))} />
        <span className="text-xs font-semibold text-foreground">{label}</span>
        {auth && (
          <span className={cn('px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider', auth.tone)}>
            {auth.badge}
          </span>
        )}
        <span className={cn('px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider', tierColor(status?.tier))}>
          {status?.tier ?? 'unknown'}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onRetry}
            disabled={retrying}
            title="Re-check this provider"
            className="flex items-center justify-center h-6 w-6 rounded border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RotateCw className={cn('w-3 h-3', retrying && 'animate-spin')} />
          </button>
          {updateCmd && (
            <UpdateButton providerId={providerId} cmd={updateCmd} onDone={setUpdate} />
          )}
        </span>
      </div>
      <div className="px-3 pb-2 space-y-1">
        <p className="text-[10px] text-muted-foreground/70">{auth ? auth.blurb : description}</p>
        <p className={cn('text-[10px] font-mono', status?.error ? 'text-amber-400/90' : 'text-muted-foreground/60')}>
          {statusText}
        </p>
        <AnimatePresence initial={false}>
          {(update.phase === 'done' || update.phase === 'error') && (update.result?.output || update.error) && (
            <motion.pre
              key="out"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className={cn(
                'overflow-x-auto max-h-40 overflow-y-auto rounded border px-2 py-1.5 text-[10px] font-mono whitespace-pre-wrap',
                update.phase === 'error' ? 'border-red-400/30 bg-red-400/5 text-red-300' : 'border-border bg-background/40 text-muted-foreground',
              )}
            >
              {update.result?.output || update.error}
            </motion.pre>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export default function ProvidersPanel() {
  const { state, dispatch } = useAppContext();
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  const probeOne = async (providerId: string) => {
    const p = PROVIDERS.find((x) => x.id === providerId);
    if (!p) return;
    setRetrying((r) => ({ ...r, [providerId]: true }));
    try {
      const status = await p.probe().catch((e: unknown) => ({
        state: 'not_detected' as ProbeState, tier: 'unknown' as const,
        label: e instanceof Error ? e.message : 'probe failed',
      }));
      dispatch({ type: 'SET_PROVIDER_STATUS', providerId, status });
    } finally {
      setRetrying((r) => ({ ...r, [providerId]: false }));
    }
  };

  // Probe any provider we don't yet have a status for, on mount.
  useEffect(() => {
    for (const p of PROVIDERS) {
      if (!state.providerStatus[p.id]) void probeOne(p.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Active model</span>
        <ModelPicker />
      </div>
      <div className="space-y-2">
        {PROVIDERS.map((p) => (
          <ProviderCard
            key={p.id}
            providerId={p.id}
            label={p.label}
            description={p.description}
            status={(state.providerStatus[p.id] ?? null) as ProbeResult | null}
            retrying={!!retrying[p.id]}
            onRetry={() => probeOne(p.id)}
          />
        ))}
      </div>
    </div>
  );
}
