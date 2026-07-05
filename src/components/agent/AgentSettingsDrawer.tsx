import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppDispatch, useAppSelector } from '@/store/store';
import ModelSelect from '@/components/ide/ModelSelect';
import ContextSelect from '@/components/ide/ContextSelect';
import { DEFAULT_COST_PREFS, loadCostPrefs } from '@/lib/agent/costPrefs';
import { findProvider } from '@/lib/agent/providers';
import type { Session, SessionModelConfig } from '@/types/session';

// ─── Per-session Agent Settings drawer ───────────────────────────────────────
// Session-scoped configuration that doesn't fit the inline context bar: model
// sampling (temperature, output cap, history window), execution-control
// overrides (retries / timeout / cost cap), and memory (knowledge base)
// toggles. Everything here affects ONLY this session; the global defaults live
// in Settings → Execution.

const CLI_PROVIDERS = new Set(['claude_code', 'antigravity', 'opencode', 'openai_codex']);

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5 border-b border-border/50 last:border-b-0">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{title}</p>
        {desc && <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-8 h-4.5 h-[18px] rounded-full transition-colors',
        checked ? 'bg-primary/80' : 'bg-muted-foreground/30',
      )}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={cn(
          'absolute top-0.5 w-3.5 h-3.5 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export default function AgentSettingsDrawer({ session, open, onClose }: {
  session: Session;
  open: boolean;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  // Live session (the prop may be a stale snapshot mid-turn).
  const live = useAppSelector((s) => s.sessions.find((x) => x.id === session.id)) ?? session;
  const cfg = live.modelConfig;
  const globals = loadCostPrefs();
  const providerId = cfg?.model.providerId ?? '';
  const isCli = CLI_PROVIDERS.has(providerId);
  const kb = live.context.kb ?? { autoInject: true, agentWrites: true };

  const patch = (p: Partial<SessionModelConfig>) =>
    dispatch({ type: 'PATCH_SESSION_MODEL_CONFIG', sessionId: live.id, patch: p });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[90] bg-background/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed right-0 top-0 bottom-0 z-[91] w-[360px] max-w-[92vw] border-l border-border bg-background shadow-2xl flex flex-col"
            initial={{ x: 380 }} animate={{ x: 0 }} exit={{ x: 380 }}
            transition={{ type: 'tween', duration: 0.18 }}
          >
            <div className="flex items-center justify-between px-4 h-12 border-b border-border flex-shrink-0">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Agent settings</h2>
                <p className="text-[10px] text-muted-foreground/60 truncate">this session only · {live.title}</p>
              </div>
              <button onClick={onClose} className="p-1.5 rounded hover:bg-accent/40 text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* ── Model ── */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5 px-1">Model</h3>
                <div className="rounded-lg border border-border">
                  <Row title="Provider · model" desc="Independent per session — other sessions keep theirs.">
                    <div className="flex items-center gap-1.5">
                      <ModelSelect />
                      <ContextSelect />
                    </div>
                  </Row>
                  <Row
                    title="Temperature"
                    desc={isCli
                      ? 'Not supported by CLI providers.'
                      : providerId === 'anthropic'
                        ? 'Ignored while extended thinking is on (API restriction).'
                        : 'Sampling randomness. Empty = provider default.'}
                  >
                    <input
                      type="number"
                      min={0} max={2} step={0.1}
                      disabled={isCli}
                      value={cfg?.temperature ?? ''}
                      placeholder="default"
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        patch({ temperature: raw === '' ? undefined : Math.max(0, Math.min(2, Number(raw))) });
                      }}
                      className="w-20 text-[11px] bg-muted/30 border border-border rounded px-2 py-1.5 focus:outline-none focus:border-ring disabled:opacity-40"
                    />
                  </Row>
                  <Row title="Max output tokens" desc={`Global default: ${(globals.maxOutputTokens).toLocaleString()}.`}>
                    <select
                      value={cfg?.maxOutputTokens ?? 0}
                      onChange={(e) => patch({ maxOutputTokens: Number(e.target.value) || undefined })}
                      className="text-[11px] bg-muted/30 border border-border rounded px-2 py-1.5 focus:outline-none focus:border-ring"
                    >
                      <option value={0}>Global</option>
                      {[8192, 16384, 32000, 64000].map((v) => (
                        <option key={v} value={v}>{v.toLocaleString()}</option>
                      ))}
                    </select>
                  </Row>
                  <Row title="History window" desc="Messages sent per turn (context cost lever).">
                    <select
                      value={cfg?.historyWindow ?? -1}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        patch({ historyWindow: v < 0 ? undefined : v });
                      }}
                      className="text-[11px] bg-muted/30 border border-border rounded px-2 py-1.5 focus:outline-none focus:border-ring"
                    >
                      <option value={-1}>Global</option>
                      <option value={0}>All</option>
                      {[10, 20, 40].map((v) => <option key={v} value={v}>Last {v}</option>)}
                    </select>
                  </Row>
                </div>
              </section>

              {/* ── Execution overrides ── */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5 px-1">Execution</h3>
                <div className="rounded-lg border border-border">
                  <Row title="Retries" desc={`Global default: ${globals.maxRetries ?? DEFAULT_COST_PREFS.maxRetries}.`}>
                    <select
                      value={cfg?.maxRetries ?? -1}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        patch({ maxRetries: v < 0 ? undefined : v });
                      }}
                      className="text-[11px] bg-muted/30 border border-border rounded px-2 py-1.5 focus:outline-none focus:border-ring"
                    >
                      <option value={-1}>Global</option>
                      {[0, 1, 2, 4, 8].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </Row>
                  <Row title="Turn timeout" desc="Hard cap per model call.">
                    <select
                      value={cfg?.turnTimeoutMs ?? -1}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        patch({ turnTimeoutMs: v < 0 ? undefined : v });
                      }}
                      className="text-[11px] bg-muted/30 border border-border rounded px-2 py-1.5 focus:outline-none focus:border-ring"
                    >
                      <option value={-1}>Global</option>
                      <option value={0}>Off</option>
                      {[[60_000, '1 min'], [180_000, '3 min'], [300_000, '5 min'], [600_000, '10 min']].map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </Row>
                  <Row title="Cost cap" desc="≈USD stop for this session. Empty = global.">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">$</span>
                      <input
                        type="number" min={0} step="0.5"
                        value={cfg?.costLimitUSD ?? ''}
                        placeholder={globals.sessionCostLimitUSD != null ? String(globals.sessionCostLimitUSD) : 'off'}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          patch({ costLimitUSD: raw === '' ? undefined : Math.max(0, Number(raw)) });
                        }}
                        className="w-20 text-[11px] bg-muted/30 border border-border rounded px-2 py-1.5 focus:outline-none focus:border-ring"
                      />
                    </div>
                  </Row>
                </div>
              </section>

              {/* ── Memory ── */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5 px-1">Memory</h3>
                <div className="rounded-lg border border-border">
                  <Row title="Inject pinned notes" desc="Prepend the project's pinned knowledge-base notes to each turn.">
                    <Toggle
                      checked={kb.autoInject}
                      onChange={(v) => dispatch({
                        type: 'PATCH_SESSION_CONTEXT', sessionId: live.id,
                        patch: { kb: { ...kb, autoInject: v } },
                      })}
                    />
                  </Row>
                  <Row title="Agent can save notes" desc="Expose the save_knowledge tool so the agent can write project memory.">
                    <Toggle
                      checked={kb.agentWrites}
                      onChange={(v) => dispatch({
                        type: 'PATCH_SESSION_CONTEXT', sessionId: live.id,
                        patch: { kb: { ...kb, agentWrites: v } },
                      })}
                    />
                  </Row>
                </div>
              </section>

              <p className="text-[10px] text-muted-foreground/50 px-1">
                Provider: {findProvider(providerId)?.label ?? (providerId || '(global default)')} ·
                behavior controls (access level, build mode, skills, sandbox) live in the session context bar.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
