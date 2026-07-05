import { cn } from '@/lib/utils';

// Generic titled card for the assorted status blocks (agent_status, security
// review, change explanation, …). `tone` colours the header label.
export function LabeledCard({ label, tone, inner }: { label: string; tone?: string; inner: string }) {
  // Empty self-closing signal (e.g. `<editor_sync/>`) — nothing to show.
  if (!inner.trim()) return null;
  return (
    <div className={cn('rounded-lg border border-border/60 bg-muted/10 overflow-hidden')}>
      <div className={cn('px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b border-border/40', tone ?? 'text-muted-foreground')}>
        {label}
      </div>
      <pre className="px-3 py-2 text-[11px] font-mono text-foreground/90 whitespace-pre-wrap max-h-64 overflow-auto">
        {inner}
      </pre>
    </div>
  );
}
