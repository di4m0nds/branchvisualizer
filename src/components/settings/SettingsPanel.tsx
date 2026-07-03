import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Sun, Moon, ZoomIn, ZoomOut, RotateCcw, Trash2, X,
  SlidersHorizontal, Palette, KeyRound, Bot, ShieldCheck, FolderGit2, Keyboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/store/AppContext';
import { useAppZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from '@/hooks/useAppZoom';
import { resetIdeLayout } from '@/lib/ideLayout';
import { loadAgentDefaults, saveAgentDefaults, type AgentDefaults } from '@/lib/agentDefaults';
import ProvidersPanel from '@/components/settings/ProvidersPanel';
import SessionsPanel from '@/components/ide/SessionsPanel';
import PinnedRulesEditor from '@/components/ide/PinnedRulesEditor';
import ArchiveSection from '@/components/settings/ArchiveSection';
import { useSystemFonts } from '@/hooks/useSystemFonts';
import { buildTerminalFontFamily } from '@/lib/terminalFont';
import type { AccessLevel, BuildMode } from '@/types/session';
import type { LogDensity } from '@/types';

// ─── Category registry ───────────────────────────────────────────────────────

type CategoryId =
  | 'general' | 'appearance' | 'providers' | 'agent' | 'rules' | 'sessions' | 'keybindings';

const CATEGORIES: { id: CategoryId; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <SlidersHorizontal className="w-4 h-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
  { id: 'providers', label: 'Providers & Keys', icon: <KeyRound className="w-4 h-4" /> },
  { id: 'agent', label: 'Agent', icon: <Bot className="w-4 h-4" /> },
  { id: 'rules', label: 'Rules', icon: <ShieldCheck className="w-4 h-4" /> },
  { id: 'sessions', label: 'Sessions', icon: <FolderGit2 className="w-4 h-4" /> },
  { id: 'keybindings', label: 'Keybindings', icon: <Keyboard className="w-4 h-4" /> },
];

// ─── Shared field primitives ─────────────────────────────────────────────────

function Field({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3 border-b border-border/60 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {desc && <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
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

// ─── Panel ───────────────────────────────────────────────────────────────────

export default function SettingsPanel({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { state, dispatch } = useAppContext();
  const { zoom, zoomIn, zoomOut, reset, setZoom } = useAppZoom();
  const isDark = state.theme === 'dark';
  const [defaults, setDefaults] = useState<AgentDefaults>(loadAgentDefaults);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [category, setCategory] = useState<CategoryId>('general');

  const updateDefaults = (patch: Partial<AgentDefaults>) => {
    const next = { ...defaults, ...patch };
    setDefaults(next);
    saveAgentDefaults(next);
  };

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-6 h-14 border-b border-border flex-shrink-0">
            <h1 className="text-base font-semibold text-foreground">Settings</h1>
            <button
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
              aria-label="Close settings"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body: nav rail + content */}
          <div className="flex flex-1 min-h-0">
            {/* Nav rail */}
            <nav className="w-56 flex-shrink-0 border-r border-border p-3 space-y-0.5 overflow-y-auto">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    'flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors',
                    category === c.id
                      ? 'bg-accent text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/30',
                  )}
                >
                  {c.icon}
                  {c.label}
                </button>
              ))}
            </nav>

            {/* Content */}
            <div className="flex-1 min-w-0 overflow-y-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={category}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.12 }}
                  className="max-w-2xl mx-auto px-8 py-6"
                >
                  {category === 'general' && (
                    <Section title="General" desc="High-level workspace behavior.">
                      <Field title="Agent log density" desc="Verbose shows everything; Clean keeps only file changes, commands, and agent messages.">
                        <Seg<LogDensity>
                          value={state.logDensity}
                          options={[{ id: 'verbose', label: 'Verbose' }, { id: 'clean', label: 'Clean' }]}
                          onChange={(density) => dispatch({ type: 'SET_LOG_DENSITY', density })}
                        />
                      </Field>
                      <Field title="Graph checkpoints" desc="Show or hide t3 checkpoint commits in the branch graph.">
                        <Seg<'hide' | 'show'>
                          value={state.showCheckpoints ? 'show' : 'hide'}
                          options={[{ id: 'hide', label: 'Hidden' }, { id: 'show', label: 'Shown' }]}
                          onChange={(v) => dispatch({ type: 'SET_SHOW_CHECKPOINTS', show: v === 'show' })}
                        />
                      </Field>
                      <Field title="Reset panel sizes" desc="Restore the IDE's split layout to defaults (reloads).">
                        <button
                          onClick={() => { resetIdeLayout(); window.location.reload(); }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border hover:bg-accent/40 text-xs"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Reset
                        </button>
                      </Field>
                    </Section>
                  )}

                  {category === 'appearance' && (
                    <Section title="Appearance" desc="Theme, scale, and terminal font.">
                      <Field title="Theme">
                        <Seg<'dark' | 'light'>
                          value={state.theme}
                          options={[{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }]}
                          onChange={(t) => { dispatch({ type: 'SET_THEME', theme: t }); document.documentElement.setAttribute('data-theme', t); }}
                        />
                      </Field>
                      <Field title="Zoom" desc="Scales the whole window (Ctrl +/-/0). Persists across restarts.">
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
                      </Field>
                      <div className="pt-3">
                        <input
                          type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} value={zoom}
                          onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setZoom(v); }}
                          className="w-full accent-primary"
                        />
                        <p className="flex items-center gap-1 text-[10px] text-muted-foreground/60 mt-1">
                          {isDark ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
                          Shortcuts scale the whole window and persist.
                        </p>
                      </div>
                      <TerminalFontField />
                    </Section>
                  )}

                  {category === 'providers' && (
                    <Section title="Providers & Keys" desc="Connect providers, check status, and keep local toolchains up to date.">
                      <ProvidersPanel />
                    </Section>
                  )}

                  {category === 'agent' && (
                    <Section title="Agent" desc="Defaults applied to newly-created sessions.">
                      <Field title="Access level" desc="How much the agent can do without asking.">
                        <Seg<AccessLevel>
                          value={defaults.accessLevel}
                          options={[{ id: 'supervised', label: 'Supervised' }, { id: 'auto_accept', label: 'Auto' }, { id: 'full_access', label: 'Full' }]}
                          onChange={(accessLevel) => updateDefaults({ accessLevel })}
                        />
                      </Field>
                      <Field title="Build mode" desc="Direct executes; Planning proposes a plan for approval first.">
                        <Seg<BuildMode>
                          value={defaults.buildMode}
                          options={[{ id: 'direct', label: 'Direct' }, { id: 'planning', label: 'Planning' }]}
                          onChange={(buildMode) => updateDefaults({ buildMode })}
                        />
                      </Field>
                    </Section>
                  )}

                  {category === 'rules' && (
                    <Section title="Pinned rules" desc="App-global rules new sessions inherit (inviolable during a turn).">
                      <div className="pt-2">
                        <button
                          onClick={() => setRulesOpen(true)}
                          className="px-2.5 py-1.5 rounded border border-border hover:bg-accent/40 text-xs"
                        >
                          Edit pinned rules ({state.pinnedRules.length})
                        </button>
                      </div>
                      <PinnedRulesEditor open={rulesOpen} onClose={() => setRulesOpen(false)} />
                    </Section>
                  )}

                  {category === 'sessions' && (
                    <Section title="Sessions" desc="Saved sessions across all projects.">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground mb-2">Active sessions</h3>
                        <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border p-1">
                          <SessionsPanel variant="inline" />
                        </div>
                      </div>
                      <ArchiveSection />
                    </Section>
                  )}

                  {category === 'keybindings' && (
                    <Section title="Keybindings" desc="Built-in shortcuts.">
                      {[
                        ['Zoom in', 'Ctrl / ⌘ +'],
                        ['Zoom out', 'Ctrl / ⌘ -'],
                        ['Reset zoom', 'Ctrl / ⌘ 0'],
                        ['Send message', 'Enter'],
                        ['Newline in composer', 'Shift + Enter'],
                        ['Close this panel', 'Esc'],
                      ].map(([label, keys]) => (
                        <Field key={label} title={label}>
                          <kbd className="px-2 py-1 rounded border border-border bg-muted/30 text-[11px] font-mono">{keys}</kbd>
                        </Field>
                      ))}
                    </Section>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {desc && <p className="text-xs text-muted-foreground/70 mt-1">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

// ─── Terminal font picker ────────────────────────────────────────────────────
// Splits off from SettingsPanel because it owns its own hook state (font
// enumeration is async) and would otherwise clutter the outer render.
function TerminalFontField() {
  const { state, dispatch } = useAppContext();
  const { fonts, nerdFonts, loading, error } = useSystemFonts();
  const selected = state.terminalFont ?? '';
  const previewFamily = buildTerminalFontFamily(state.terminalFont, nerdFonts);

  const setFont = (family: string | null) =>
    dispatch({ type: 'SET_TERMINAL_FONT', family });

  return (
    <>
      <Field
        title="Terminal font"
        desc="Applies to the in-IDE terminal and nvim. Uses the built-in monospace stack when unset."
      >
        {error === 'unsupported' ? (
          <input
            type="text"
            placeholder="Family name (e.g. JetBrains Mono)"
            value={selected}
            onChange={(e) => setFont(e.target.value.trim() || null)}
            className="w-56 px-2 py-1 rounded border border-border bg-background text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        ) : (
          <select
            value={selected}
            disabled={loading}
            onChange={(e) => setFont(e.target.value || null)}
            className="w-56 px-2 py-1 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
          >
            <option value="">System default</option>
            {fonts.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        )}
      </Field>
      <div className="pt-3 space-y-2">
        {nerdFonts.length > 0 && (
          <p className="text-[10px] text-muted-foreground/70">
            Nerd Font detected: <span className="font-mono">{nerdFonts[0]}</span> — icons will render as glyphs.
          </p>
        )}
        {error === 'denied' && (
          <p className="text-[10px] text-muted-foreground/70">
            Font enumeration was denied. Reload the app and allow the local-fonts prompt to see installed families.
          </p>
        )}
        {error === 'unsupported' && (
          <p className="text-[10px] text-muted-foreground/70">
            This webview can't enumerate system fonts — type an installed family name above.
          </p>
        )}
        <div
          className="rounded border border-border bg-muted/20 px-3 py-2 text-[13px]"
          style={{ fontFamily: previewFamily }}
        >
          ABCabc123 →⚙ 󰈚
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          If arrows or icons appear as boxes, no Nerd Font is available on this system.
        </p>
      </div>
    </>
  );
}
