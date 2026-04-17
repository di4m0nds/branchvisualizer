import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
}

export function Tooltip({ content, children, side = 'top', delay = 400, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [placement, setPlacement] = useState<'top' | 'bottom' | 'left' | 'right'>(side);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  function computePlacement(): 'top' | 'bottom' | 'left' | 'right' {
    if (!wrapperRef.current) return side;
    const rect = wrapperRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Flip if too close to an edge
    if (side === 'top'    && rect.top    < 90)        return 'bottom';
    if (side === 'bottom' && rect.bottom > vh - 90)   return 'top';
    if (side === 'left'   && rect.left   < 170)       return 'right';
    if (side === 'right'  && rect.right  > vw - 170)  return 'left';
    return side;
  }

  function show() {
    setPlacement(computePlacement());
    timer.current = setTimeout(() => setVisible(true), delay);
  }

  function hide() {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const positions: Record<string, string> = {
    top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left:   'right-full top-1/2 -translate-y-1/2 mr-2',
    right:  'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            role="tooltip"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.1 }}
            className={cn(
              'absolute z-[9999] px-2 py-1 text-xs font-medium',
              'bg-surface-2 border border-border text-foreground',
              'rounded-md shadow-lg whitespace-nowrap pointer-events-none',
              positions[placement],
              className,
            )}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
