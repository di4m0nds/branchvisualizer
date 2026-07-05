// ─── Minimized tool "backbox" ───────────────────────────────────────────────
// One-line collapsed row for a tool step / code dump / diff: status dot, icon,
// mono tool name, truncated description, chevron. Expanding reveals the full
// renderer. Clean density collapses these by default so the transcript reads
// as prose with the machinery visible-but-quiet; verbose expands them. The
// default follows density/streaming until the user toggles the row themselves.

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ToolRow({
  icon, title, subtitle, status = 'ok', defaultOpen = false, children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  status?: 'ok' | 'error' | 'running';
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const touched = useRef(false);
  // Density flips / streaming settling re-drive the default until the user
  // explicitly opens or closes this row — then their choice wins.
  useEffect(() => {
    if (!touched.current) setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <div className={cn(
      'rounded-md border overflow-hidden transition-colors',
      status === 'error'
        ? 'border-red-500/30 bg-red-500/5'
        : open ? 'border-border/60 bg-muted/10' : 'border-border/40 bg-muted/5',
    )}>
      <button
        onClick={() => { touched.current = true; setOpen((o) => !o); }}
        className="flex items-center gap-2 w-full h-7 px-2 text-left hover:bg-muted/20 transition-colors"
        aria-expanded={open}
      >
        <ChevronRight className={cn('w-3 h-3 flex-shrink-0 text-muted-foreground/60 transition-transform', open && 'rotate-90')} />
        <span className={cn(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          status === 'error' ? 'bg-red-400' : status === 'running' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400',
        )} />
        {icon}
        <span className="font-mono text-[11px] font-medium text-foreground/85 flex-shrink-0">{title}</span>
        {subtitle && <span className="text-[11px] text-muted-foreground truncate">{subtitle}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/40 p-1.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
