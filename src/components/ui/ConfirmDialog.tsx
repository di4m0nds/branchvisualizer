// Portal-mounted confirm modal. Replaces window.confirm() for destructive
// actions across the app (thread/project delete, archive bulk actions).
// Escape or backdrop click cancels; Enter confirms.

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, description,
  confirmLabel = 'Delete', cancelLabel = 'Cancel',
  variant = 'destructive',
  onConfirm, onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={onCancel}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.12 }}
            className="w-full max-w-md rounded-lg border border-border bg-popover shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4 flex items-start gap-3">
              <div className={cn(
                'flex-shrink-0 mt-0.5 h-8 w-8 rounded-full flex items-center justify-center',
                variant === 'destructive' ? 'bg-destructive/15 text-destructive' : 'bg-accent/40 text-foreground',
              )}>
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="confirm-title" className="text-sm font-semibold text-foreground leading-snug">{title}</h2>
                {description && (
                  <div className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{description}</div>
                )}
              </div>
            </div>
            <div className="px-5 py-3 bg-muted/20 border-t border-border flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel} autoFocus>
                {cancelLabel}
              </Button>
              <Button
                variant={variant === 'destructive' ? 'destructive' : 'default'}
                size="sm"
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
