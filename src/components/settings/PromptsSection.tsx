import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  getPrompt, hasOverride, listPrompts, setPromptOverride, type PromptTemplate,
} from '@/lib/agent/prompts';

// ─── Settings → Prompts ──────────────────────────────────────────────────────
// Every template the IDE sends to models, grouped and editable. Overrides are
// localStorage-persisted and take effect on the NEXT request. The base system
// prompt carries a cache warning (editing invalidates the Anthropic prompt
// cache once).

const GROUP_LABELS: Record<PromptTemplate['group'], { title: string; desc: string }> = {
  system: { title: 'System prompt (API providers)', desc: 'Sent to Anthropic / Gemini / OpenAI / MiniMax / OpenCode transports.' },
  claude_code: { title: 'Claude Code CLI', desc: 'Sent to the claude CLI via --append-system-prompt.' },
  drivers: { title: 'Driver prompts', desc: 'Short texts the IDE sends on approvals, resumes, denials, and routed tasks.' },
  skills: { title: 'Skill fragments', desc: 'Per-skill behavior lines appended when a skill toggle is on.' },
};

const GROUP_ORDER: PromptTemplate['group'][] = ['system', 'claude_code', 'drivers', 'skills'];

/** ~4 chars/token — a rough but honest estimate for budgeting. */
function tokenEstimate(text: string): string {
  const t = Math.round(text.length / 4);
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k tok` : `${t} tok`;
}

export default function PromptsSection() {
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  // Bump to re-render rows after save/reset (registry is module state).
  const [rev, setRev] = useState(0);
  const groups = useMemo(() => {
    const all = listPrompts();
    return GROUP_ORDER.map((g) => ({ group: g, items: all.filter((t) => t.group === g) }));
  }, []);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">Prompts</h2>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Edit what the IDE sends to models — tune tone, tighten output for cheaper turns, or
          reshape plans and questions. Changes apply on the next request. <span className="text-amber-500">Overridden templates are marked.</span>
        </p>
      </div>

      {groups.map(({ group, items }) => (
        <div key={group} className="mb-6" data-rev={rev}>
          <h3 className="text-sm font-semibold text-foreground">{GROUP_LABELS[group].title}</h3>
          <p className="text-[11px] text-muted-foreground/70 mb-2">{GROUP_LABELS[group].desc}</p>
          <div className="rounded-lg border border-border divide-y divide-border/60">
            {items.map((t) => {
              const overridden = hasOverride(t.id);
              const effective = getPrompt(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => setEditing(t)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-foreground">{t.label}</span>
                    <p className="text-[10px] text-muted-foreground/60 truncate">{t.description}</p>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground/50 flex-shrink-0">{tokenEstimate(effective)}</span>
                  {overridden && (
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/30 flex-shrink-0">
                      edited
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {editing && (
        <PromptEditorModal
          template={editing}
          onClose={() => { setEditing(null); setRev((r) => r + 1); }}
        />
      )}
    </div>
  );
}

function PromptEditorModal({ template, onClose }: { template: PromptTemplate; onClose: () => void }) {
  const [text, setText] = useState(() => getPrompt(template.id));
  const dirty = text !== getPrompt(template.id);
  const isDefault = text === template.defaultText;

  const save = () => {
    setPromptOverride(template.id, text);
    onClose();
  };
  const reset = () => {
    setPromptOverride(template.id, null);
    setText(template.defaultText);
  };

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border border-border bg-popover shadow-2xl">
        <div className="px-5 py-3 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">{template.label}</h3>
            <span className="text-[10px] font-mono text-muted-foreground">{text.length.toLocaleString()} chars · ~{tokenEstimate(text)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">{template.description}</p>
          {template.vars && template.vars.length > 0 && (
            <p className="text-[10px] font-mono text-cyan-400/80 mt-1">
              Placeholders: {template.vars.map((v) => `{${v}}`).join(' · ')}
            </p>
          )}
          {template.id === 'base_system' && (
            <p className="text-[10px] text-amber-500 mt-1">
              ⚠ Editing invalidates the Anthropic prompt cache once — the next turn re-caches the new prefix.
            </p>
          )}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="flex-1 min-h-[320px] resize-none px-5 py-3 bg-transparent font-mono text-[11.5px] leading-relaxed text-foreground focus:outline-none"
        />

        <div className="flex items-center gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={reset}
            disabled={isDefault}
            className={cn(
              'px-2.5 py-1.5 rounded text-[11px] border transition-colors',
              isDefault
                ? 'border-border text-muted-foreground/40 cursor-not-allowed'
                : 'border-amber-500/40 text-amber-500 hover:bg-amber-500/10',
            )}
          >
            Reset to default
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="px-2.5 py-1.5 rounded text-[11px] border border-border text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className={cn(
              'px-3 py-1.5 rounded text-[11px] font-medium border transition-colors',
              dirty
                ? 'border-primary/40 bg-primary/15 text-primary hover:bg-primary/25'
                : 'border-border text-muted-foreground/40 cursor-not-allowed',
            )}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
