import { useState } from 'react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/Select';
import { NumberInput } from '@/components/ui/NumberInput';
import {
  DEFAULT_COST_PREFS, loadCostPrefs, saveCostPrefs, type CostPrefs,
} from '@/lib/agent/costPrefs';
import {
  loadCustomProviderSpecs, saveCustomProviderSpecs, type CustomProviderSpec,
} from '@/lib/agent/providers/custom';
import { nextId } from '@/types/session';

// ─── Settings → Execution ────────────────────────────────────────────────────
// Global execution-control defaults: retry policy, turn timeout, and hard cost
// limits (enforced in the agent loop before every model call). Per-session
// overrides live in the session's Agent Settings drawer. Also hosts the
// custom OpenAI-compatible endpoint registry.

export default function ExecutionSection() {
  const [prefs, setPrefs] = useState<CostPrefs>(loadCostPrefs);

  const update = (patch: Partial<CostPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveCostPrefs(next);
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">Execution</h2>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Retry, timeout, and cost-limit defaults enforced by the agent loop. Sessions can
          override these individually from their Agent Settings drawer.
        </p>
      </div>

      <h3 className="text-sm font-semibold text-foreground mb-2">Retries & timeouts</h3>
      <div className="rounded-lg border border-border divide-y divide-border/60 mb-6">
        <SelectRow
          title="Model-call retries"
          desc="Transient errors (429 / 5xx / network) retried with backoff. Aborts are never retried."
          value={prefs.maxRetries}
          options={[[0, 'Off'], [1, '1'], [2, '2 (default)'], [4, '4'], [8, '8']]}
          onChange={(v) => update({ maxRetries: v })}
        />
        <SelectRow
          title="Turn timeout"
          desc="Hard wall-clock cap per model call. A timed-out turn surfaces as a retryable error card."
          value={prefs.turnTimeoutMs}
          options={[[0, 'Off (default)'], [60_000, '1 min'], [180_000, '3 min'], [300_000, '5 min'], [600_000, '10 min']]}
          onChange={(v) => update({ turnTimeoutMs: v })}
        />
      </div>

      <h3 className="text-sm font-semibold text-foreground mb-2">Cost limits</h3>
      <div className="rounded-lg border border-border divide-y divide-border/60 mb-2">
        <LimitRow
          title="Per-session cap"
          desc="Turns stop once a session's ≈USD spend crosses this. Resumable after raising the cap."
          value={prefs.sessionCostLimitUSD}
          onChange={(v) => update({ sessionCostLimitUSD: v })}
        />
        <LimitRow
          title="Daily cap"
          desc="Applies across all sessions, resetting at local midnight."
          value={prefs.dailyCostLimitUSD}
          onChange={(v) => update({ dailyCostLimitUSD: v })}
        />
      </div>
      <p className="text-[10px] text-muted-foreground/60 mb-6">
        Costs are approximate (static price table); subscription CLIs (Claude Code) may not bill
        per token. Defaults: {DEFAULT_COST_PREFS.maxRetries} retries · no timeout · no caps.
      </p>

      <CustomProvidersEditor />
    </div>
  );
}

function SelectRow({ title, desc, value, options, onChange }: {
  title: string; desc: string; value: number;
  options: [number, string][]; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="text-[10px] text-muted-foreground/60">{desc}</p>
      </div>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="min-w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, label]) => (
            <SelectItem key={v} value={String(v)}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function LimitRow({ title, desc, value, onChange }: {
  title: string; desc: string; value: number | null; onChange: (v: number | null) => void;
}) {
  // Local draft so mid-edit strings like "1." survive the controlled round-trip.
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="text-[10px] text-muted-foreground/60">{desc}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">$</span>
        <NumberInput
          min={0}
          value={draft}
          placeholder="off"
          onChange={(raw) => {
            setDraft(raw);
            const trimmed = raw.trim();
            const n = Number(trimmed);
            onChange(trimmed === '' || !Number.isFinite(n) ? null : Math.max(0, n));
          }}
          className="w-20"
        />
      </div>
    </div>
  );
}

// ─── Custom OpenAI-compatible endpoints ──────────────────────────────────────

function CustomProvidersEditor() {
  const [specs, setSpecs] = useState<CustomProviderSpec[]>(loadCustomProviderSpecs);
  const [draft, setDraft] = useState({ label: '', baseUrl: '', modelIds: '', requiresKey: false });

  const persist = (next: CustomProviderSpec[]) => {
    setSpecs(next);
    saveCustomProviderSpecs(next);
  };

  const add = () => {
    if (!draft.baseUrl.trim()) return;
    persist([...specs, {
      id: nextId('custom'),
      label: draft.label.trim() || draft.baseUrl.trim(),
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
      modelIds: draft.modelIds.split(',').map((s) => s.trim()).filter(Boolean),
      requiresKey: draft.requiresKey,
    }]);
    setDraft({ label: '', baseUrl: '', modelIds: '', requiresKey: false });
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-2">Custom providers</h3>
      <p className="text-[10px] text-muted-foreground/60 mb-2">
        Any OpenAI-compatible endpoint (LM Studio, vLLM, LiteLLM, a corporate gateway…).
        Changes apply after the app reloads. Keys are entered per provider in the model picker.
      </p>
      {specs.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border/60 mb-3">
          {specs.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">{s.label}</p>
                <p className="text-[10px] font-mono text-muted-foreground/60 truncate">
                  {s.baseUrl} · {s.modelIds.join(', ') || 'default'}{s.requiresKey ? ' · keyed' : ''}
                </p>
              </div>
              <button
                onClick={() => persist(specs.filter((x) => x.id !== s.id))}
                className="text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400/40"
              >
                remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Label (e.g. LM Studio)"
            className="flex-1 text-[11px] bg-muted/30 border border-border rounded px-2 py-1.5 focus:outline-none focus:border-ring"
          />
          <input
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder="Base URL (http://localhost:1234/v1)"
            className="flex-[2] text-[11px] font-mono bg-muted/30 border border-border rounded px-2 py-1.5 focus:outline-none focus:border-ring"
          />
        </div>
        <div className="flex gap-2 items-center">
          <input
            value={draft.modelIds}
            onChange={(e) => setDraft({ ...draft, modelIds: e.target.value })}
            placeholder="Model ids, comma-separated"
            className="flex-1 text-[11px] font-mono bg-muted/30 border border-border rounded px-2 py-1.5 focus:outline-none focus:border-ring"
          />
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              checked={draft.requiresKey}
              onChange={(e) => setDraft({ ...draft, requiresKey: e.target.checked })}
            />
            requires key
          </label>
          <button
            onClick={add}
            disabled={!draft.baseUrl.trim()}
            className="px-2.5 py-1.5 rounded border border-border hover:bg-accent/40 text-[11px] disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
