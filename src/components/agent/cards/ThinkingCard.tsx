import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Collapsible "Thinking…" card ────────────────────────────────────────────
// Surfaces the model's reasoning. Collapsed by default with a one-line preview
// (live tail while streaming, opening line once settled) so the closed card
// still tells you what the model is working through.

export function ThinkingCard({ inner, streaming }: { inner: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const lines = inner.trim().split('\n').filter((l) => l.trim());
  const preview = (streaming ? lines[lines.length - 1] : lines[0]) ?? '';
  return (
    <div className="rounded-lg border border-violet-500/25 bg-violet-500/5 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left hover:bg-muted/20 transition-colors"
      >
        <Brain className={cn('w-3 h-3 flex-shrink-0 text-muted-foreground', streaming && 'animate-pulse text-primary')} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-shrink-0">
          {streaming ? 'Thinking…' : 'Thought process'}
        </span>
        {!open && preview && (
          <span className="text-[10px] italic text-muted-foreground/50 truncate min-w-0">{preview}</span>
        )}
        <ChevronDown className={cn('w-3 h-3 ml-auto flex-shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <pre className="px-2.5 py-1.5 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap max-h-64 overflow-auto border-t border-border/50">
              {inner}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
