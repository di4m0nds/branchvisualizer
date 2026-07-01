import { useState } from 'react';
import { Sun, Moon, ZoomIn, ZoomOut, RotateCcw, Trash2 } from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/store/AppContext';
import { useAppZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from '@/hooks/useAppZoom';
import { resetIdeLayout } from '@/lib/ideLayout';
import { loadAgentDefaults, saveAgentDefaults, type AgentDefaults } from '@/lib/agentDefaults';
import ModelPicker from '@/components/ide/ModelPicker';
import SessionsPanel from '@/components/ide/SessionsPanel';
import PinnedRulesEditor from '@/components/ide/PinnedRulesEditor';
import type { AccessLevel, BuildMode } from '@/types/session';

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 py-4 border-b border-border last:border-b-0">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {desc && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border bg-muted/30">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn('px-2.5 py-1 rounded text-[11px] font-medium transition-colors capitalize',
            value === o.id ? 'bg-accent text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsPanel({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { state, dispatch } = useAppContext();
  const { zoom, zoomIn, zoomOut, reset, setZoom } = useAppZoom();
  const isDark = state.theme === 'dark';
  const [defaults, setDefaults] = useState<AgentDefaults>(loadAgentDefaults);
  const [rulesOpen, setRulesOpen] = useState(false);

  const updateDefaults = (patch: Partial<AgentDefaults>) => {
    const next = { ...defaults, ...patch };
    setDefaults(next);
    saveAgentDefaults(next);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Configure appearance, providers, and agent defaults.</SheetDescription>
        </SheetHeader>

        <div className="px-1">
          {/* Appearance */}
          <Section title="Appearance" desc="Theme and interface scale.">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Theme</span>
              <Seg<'dark' | 'light'>
                value={state.theme}
                options={[{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }]}
                onChange={(t) => { dispatch({ type: 'SET_THEME', theme: t }); document.documentElement.setAttribute('data-theme', t); }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Zoom <span className="opacity-50">(Ctrl +/-/0)</span></span>
              <div className="flex items-center gap-1">
                <button onClick={zoomOut} disabled={zoom <= ZOOM_MIN}
                  className="h-7 w-7 flex items-center justify-center rounded border border-border hover:bg-accent/40 disabled:opacity-40">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="w-12 text-center text-[11px] font-mono tabular-nums">{Math.round(zoom * 100)}%</span>
                <button onClick={zoomIn} disabled={zoom >= ZOOM_MAX}
                  className="h-7 w-7 flex items-center justify-center rounded border border-border hover:bg-accent/40 disabled:opacity-40">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button onClick={reset} title="Reset zoom"
                  className="h-7 w-7 flex items-center justify-center rounded border border-border hover:bg-accent/40">
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <input
              type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} value={zoom}
              onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setZoom(v); }}
              className="w-full accent-primary"
            />
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
              {isDark ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
              Shortcuts scale the whole window and persist.
            </p>
          </Section>

          {/* Providers & tokens */}
          <Section title="Providers & tokens" desc="Paste an API key to connect a provider; status refreshes automatically.">
            <ModelPicker />
          </Section>

          {/* Agent defaults */}
          <Section title="Agent defaults" desc="Applied to newly-created sessions.">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Access level</span>
              <Seg<AccessLevel>
                value={defaults.accessLevel}
                options={[{ id: 'supervised', label: 'Supervised' }, { id: 'auto_accept', label: 'Auto' }, { id: 'full_access', label: 'Full' }]}
                onChange={(accessLevel) => updateDefaults({ accessLevel })}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Build mode</span>
              <Seg<BuildMode>
                value={defaults.buildMode}
                options={[{ id: 'direct', label: 'Direct' }, { id: 'planning', label: 'Planning' }]}
                onChange={(buildMode) => updateDefaults({ buildMode })}
              />
            </div>
          </Section>

          {/* Rules */}
          <Section title="Pinned rules" desc="App-global rules new sessions inherit (inviolable during a turn).">
            <button
              onClick={() => setRulesOpen(true)}
              className="px-2.5 py-1.5 rounded border border-border hover:bg-accent/40 text-xs"
            >
              Edit pinned rules ({state.pinnedRules.length})
            </button>
            <PinnedRulesEditor open={rulesOpen} onClose={() => setRulesOpen(false)} />
          </Section>

          {/* Sessions */}
          <Section title="Sessions" desc="Saved sessions across all projects.">
            <div className="max-h-56 overflow-y-auto rounded-md border border-border p-1">
              <SessionsPanel variant="inline" />
            </div>
          </Section>

          {/* Layout */}
          <Section title="Layout" desc="Reset IDE panel sizes to their defaults.">
            <button
              onClick={() => { resetIdeLayout(); window.location.reload(); }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border hover:bg-accent/40 text-xs"
            >
              <Trash2 className="w-3.5 h-3.5" /> Reset panel sizes
            </button>
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
