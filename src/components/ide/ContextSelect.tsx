import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessionModel } from '@/hooks/useSessionModel';
import { findProvider } from '@/lib/agent/providers';
import type { ContextOption } from '@/lib/agent/transport';

// ─── Context-window selector ─────────────────────────────────────────────────
// Dedicated dropdown for the context size (Standard 200K / 1M), shown next to
// the model picker ONLY when the active model exposes more than one option.
// Writes ModelRef.context through the same session-scoped setter the model
// picker uses, so the choice flows straight into the transport.

const PANEL_W = 220;

function shortLabel(id: string): string {
  return id === '1m' ? '1M' : 'STD 200K';
}

export default function ContextSelect() {
  const { selected, setModel } = useSessionModel();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const provider = findProvider(selected.providerId);
  const model = provider?.models().find((m) => m.id === selected.modelId);
  const options: ContextOption[] = model?.contextOptions ?? [];
  const activeCtx = selected.context ?? 'standard';

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // Only models with a real choice get the control — Haiku/Opus render nothing.
  if (options.length <= 1) return null;

  const pick = (id: ContextOption['id']) => {
    setModel({ ...selected, context: id });
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Context window size"
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-md border bg-muted/30 text-[10px] font-mono transition-colors',
          activeCtx === '1m'
            ? 'border-primary/40 text-primary'
            : 'border-border text-muted-foreground hover:text-foreground',
        )}
      >
        <span>{shortLabel(activeCtx)}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-lg border border-border bg-popover shadow-xl overflow-hidden"
          style={{ width: PANEL_W }}
        >
          <div className="px-2.5 py-1.5 border-b border-border">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Context window</span>
          </div>
          {options.map((opt) => {
            const active = activeCtx === opt.id;
            const oneM = opt.id === '1m';
            return (
              <button
                key={opt.id}
                onClick={() => pick(opt.id)}
                className={cn(
                  'w-full text-left px-2.5 py-1.5 transition-colors',
                  active ? 'bg-primary/10' : 'hover:bg-accent/30',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn('text-[11px] font-medium', active ? 'text-primary' : 'text-foreground/85')}>
                    {opt.label}
                  </span>
                  <span className="ml-auto text-[9px] font-mono text-muted-foreground/70">
                    {opt.tokens.toLocaleString()} tok
                  </span>
                </div>
                {oneM && selected.providerId === 'claude_code' && (
                  <div className="text-[9px] text-amber-500/80 mt-0.5">
                    Requires usage credits on a Claude Code plan
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
