import { useState } from 'react';
import { Copy, Check, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/services/toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

// Hover-revealed per-message toolbar. Copy is available on every message; Revert
// is only meaningful on user messages and only when the session isn't currently
// working. Revert opens a confirmation, then drops the target message + every
// message after it from the session and restores the target's text into the
// composer so the user can edit and resend.

export default function MessageActions({
  text, copyText, isUser, canRevert, onRevert, align = 'left',
}: {
  text: string;
  /** Clean text to place on the clipboard (defaults to `text`). Assistant
   *  messages pass prose-only text so tags/logs aren't copied. */
  copyText?: string;
  isUser: boolean;
  canRevert: boolean;
  onRevert: () => void;
  align?: 'left' | 'right';
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText ?? text);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity',
          align === 'right' ? 'justify-end' : 'justify-start',
        )}
      >
        <button
          onClick={copy}
          title="Copy message"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        {isUser && canRevert && (
          <button
            onClick={() => setConfirming(true)}
            title="Revert conversation to this message"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title="Revert conversation to this point?"
        description="This will remove this message and every message that came after it. The message text will be restored to the composer so you can edit and resend."
        confirmLabel="Revert"
        variant="destructive"
        onConfirm={() => { setConfirming(false); onRevert(); }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
