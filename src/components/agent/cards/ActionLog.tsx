import { cn } from '@/lib/utils';

// A single CLI/tool step (read / grep / edit / run …). The most frequent card,
// so it stays compact and log-like.
export function ActionLog({ data }: { data: Record<string, unknown> }) {
  const status = String(data.status ?? 'complete');
  const isErr = status === 'error';
  const output = String(data.output ?? '');
  return (
    <div className={cn(
      'rounded-lg border text-xs overflow-hidden',
      isErr ? 'border-red-500/30 bg-red-500/5' : 'border-border/60 bg-muted/15',
    )}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', isErr ? 'bg-red-400' : 'bg-emerald-400')} />
        <span className="font-mono text-[11px] font-medium text-foreground/90 flex-shrink-0">{String(data.tool)}</span>
        <span className="text-muted-foreground truncate">{String(data.description)}</span>
      </div>
      {output && (
        <pre className="px-3 py-1.5 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap max-h-40 overflow-auto border-t border-border/40 bg-background/30">
          {output}
        </pre>
      )}
    </div>
  );
}
