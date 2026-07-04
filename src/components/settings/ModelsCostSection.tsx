import { useMemo, useState } from 'react';
import { useAppSelector } from '@/store/store';
import { PROVIDERS } from '@/lib/agent/providers';
import {
  TASK_LABELS, loadRouting, saveRouting, type ModelRouting, type TaskRoute, type TaskType,
} from '@/lib/agent/modelRouting';
import {
  DEFAULT_COST_PREFS, loadCostPrefs, saveCostPrefs, type CostPrefs,
} from '@/lib/agent/costPrefs';
import { estimateTotalCost, formatCost, priceFor } from '@/lib/agent/pricing';

// ─── Settings → Models & Cost ────────────────────────────────────────────────
// Per-task model routing (cheap models for cheap tasks, seamless fallback when
// a provider isn't connected), context budget controls, and a per-session
// approximate cost breakdown.

const TASKS: TaskType[] = ['main', 'planning', 'title'];

function routeKey(r: TaskRoute | undefined): string {
  if (!r || r === 'session') return 'session';
  return `${r.providerId}::${r.modelId}`;
}

export default function ModelsCostSection() {
  const providerStatus = useAppSelector((s) => s.providerStatus);
  const sessions = useAppSelector((s) => s.sessions);
  const [routing, setRouting] = useState<ModelRouting>(loadRouting);
  const [prefs, setPrefs] = useState<CostPrefs>(loadCostPrefs);

  const setRoute = (task: TaskType, key: string) => {
    const next: ModelRouting = { ...routing };
    if (key === 'session') delete next[task];
    else {
      const [providerId, modelId] = key.split('::');
      next[task] = { providerId, modelId, context: 'standard' };
    }
    setRouting(next);
    saveRouting(next);
  };

  const updatePrefs = (patch: Partial<CostPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveCostPrefs(next);
  };

  // provider → model options, connected providers first (mirrors the model menu).
  const options = useMemo(() => {
    const ranked = [...PROVIDERS].sort((a, b) => {
      const rank = (id: string) => (providerStatus[id]?.state === 'connected' ? 0 : providerStatus[id]?.state === 'detected' ? 1 : 2);
      return rank(a.id) - rank(b.id);
    });
    return ranked.map((p) => ({
      provider: p,
      connected: providerStatus[p.id]?.state === 'connected',
      models: p.models(),
    }));
  }, [providerStatus]);

  const costRows = useMemo(() =>
    sessions
      .map((s) => {
        const usages = s.messages.map((m) => m.usage).filter((u): u is NonNullable<typeof u> => !!u);
        const cost = usages.length ? estimateTotalCost(usages) : null;
        const tokens = usages.reduce((n, u) => n + u.input + u.output, 0);
        return { id: s.id, title: s.title, tokens, cost };
      })
      .filter((r) => r.tokens > 0)
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
      .slice(0, 12),
  [sessions]);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">Models & Cost</h2>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Route cheap tasks to cheap models and bound what each turn can spend. Routing silently
          falls back to the session model whenever the routed provider isn't connected.
        </p>
      </div>

      {/* Task routing */}
      <h3 className="text-sm font-semibold text-foreground mb-2">Task routing</h3>
      <div className="rounded-lg border border-border divide-y divide-border/60 mb-6">
        {TASKS.map((task) => {
          const current = routing[task];
          const routedProvider = current && current !== 'session' ? current.providerId : null;
          const inactive = routedProvider && providerStatus[routedProvider]?.state !== 'connected';
          return (
            <div key={task} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">{TASK_LABELS[task].label}</p>
                <p className="text-[10px] text-muted-foreground/60">{TASK_LABELS[task].description}</p>
                {inactive && (
                  <p className="text-[10px] text-amber-500 mt-0.5">
                    Provider not connected — falling back to the session model.
                  </p>
                )}
              </div>
              <select
                value={routeKey(current)}
                onChange={(e) => setRoute(task, e.target.value)}
                className="text-[11px] bg-muted/30 border border-border rounded px-2 py-1.5 text-foreground focus:outline-none focus:border-ring max-w-[240px]"
              >
                <option value="session">Session model (default)</option>
                {options.map(({ provider, connected, models }) => (
                  <optgroup key={provider.id} label={`${provider.label}${connected ? '' : ' (not connected)'}`}>
                    {models.map((m) => {
                      const price = priceFor(m.id);
                      return (
                        <option key={`${provider.id}::${m.id}`} value={`${provider.id}::${m.id}`}>
                          {m.label}{price ? ` · ≈$${price.inPerM}/$${price.outPerM} per MTok` : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      {/* Context budgets */}
      <h3 className="text-sm font-semibold text-foreground mb-2">Context budgets</h3>
      <div className="rounded-lg border border-border divide-y divide-border/60 mb-6">
        <BudgetRow
          title="History window"
          desc="Messages sent per turn. Smaller = cheaper turns; the agent loses older context."
          value={prefs.historyWindow}
          options={[[0, 'All'], [10, 'Last 10'], [20, 'Last 20'], [40, 'Last 40']]}
          onChange={(v) => updatePrefs({ historyWindow: v })}
        />
        <BudgetRow
          title="Tool output cap"
          desc="Max characters of each tool result sent back to the model (head + tail kept)."
          value={prefs.toolResultCap}
          options={[[8000, '8k'], [16000, '16k'], [24000, '24k (default)'], [48000, '48k']]}
          onChange={(v) => updatePrefs({ toolResultCap: v })}
        />
        <BudgetRow
          title="Max output tokens"
          desc="Response budget per model call."
          value={prefs.maxOutputTokens}
          options={[[8192, '8k'], [16384, '16k'], [32000, '32k'], [64000, '64k (default)']]}
          onChange={(v) => updatePrefs({ maxOutputTokens: v })}
        />
      </div>
      <p className="text-[10px] text-muted-foreground/60 mb-6">
        Defaults: all history · {DEFAULT_COST_PREFS.toolResultCap.toLocaleString()} chars · {DEFAULT_COST_PREFS.maxOutputTokens.toLocaleString()} tokens.
        Changes apply on the next turn.
      </p>

      {/* Cost breakdown */}
      <h3 className="text-sm font-semibold text-foreground mb-2">Session costs (approximate)</h3>
      {costRows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/60">No usage recorded yet — costs appear after agent turns.</p>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border/60">
          {costRows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2">
              <span className="text-xs text-foreground truncate flex-1">{r.title}</span>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums">{r.tokens.toLocaleString()} tok</span>
              <span className="text-[11px] font-mono text-foreground tabular-nums w-16 text-right">
                {r.cost !== null ? `≈${formatCost(r.cost)}` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/60 mt-2">
        Prices come from a static table (src/lib/agent/pricing.ts) — approximate by design; subscription
        CLIs (Claude Code) may not bill per token at all.
      </p>
    </div>
  );
}

function BudgetRow({ title, desc, value, options, onChange }: {
  title: string;
  desc: string;
  value: number;
  options: [number, string][];
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="text-[10px] text-muted-foreground/60">{desc}</p>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="text-[11px] bg-muted/30 border border-border rounded px-2 py-1.5 text-foreground focus:outline-none focus:border-ring"
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    </div>
  );
}
