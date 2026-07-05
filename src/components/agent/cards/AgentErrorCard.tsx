import { AlertTriangle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { extractAttr } from '../blocks';

// ─── Agent error card ────────────────────────────────────────────────────────
// Terminal failures (provider errors, tool blowups) and user stops render as a
// distinct card instead of loose warning text. Retry — latest turn only —
// replays the last user message.

export function AgentErrorCard({ data, interactive, onRetry }: {
  data: Record<string, unknown>;
  interactive: boolean;
  onRetry?: () => void;
}) {
  const kind = extractAttr(String(data.attrs ?? ''), 'kind') ?? 'provider';
  const message = String(data.inner ?? '').trim() || 'Something went wrong.';
  const aborted = kind === 'aborted';
  return (
    <div className={cn(
      'rounded-lg border overflow-hidden',
      aborted ? 'border-amber-500/30 bg-amber-500/5' : 'border-destructive/40 bg-destructive/5',
    )}>
      <div className="flex items-center gap-2 px-3 py-2">
        <AlertTriangle className={cn('w-4 h-4 flex-shrink-0', aborted ? 'text-amber-400' : 'text-destructive')} />
        <span className="text-xs font-semibold text-foreground">
          {aborted ? 'Stopped by user' : 'Agent error'}
        </span>
        {!aborted && interactive && onRetry && (
          <Button size="xs" variant="outline" className="ml-auto" onClick={onRetry}>
            <RotateCcw className="w-3 h-3 mr-1" /> Retry
          </Button>
        )}
      </div>
      {!aborted && (
        <p className="px-3 pb-2.5 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
          {message}
        </p>
      )}
    </div>
  );
}
