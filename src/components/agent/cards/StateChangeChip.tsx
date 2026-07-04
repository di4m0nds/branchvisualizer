import { CornerDownRight } from 'lucide-react';

// ─── Session-state-change chip ───────────────────────────────────────────────

export function StateChangeChip({ data }: { data: Record<string, unknown> }) {
  const to = String(data.to ?? '');
  const reason = String(data.reason ?? '');
  if (!to) return null;
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-0.5" title={reason}>
      <CornerDownRight className="w-3 h-3 flex-shrink-0" />
      <span>state → <span className="font-medium text-foreground/80">{to.replace(/_/g, ' ')}</span></span>
      {reason && <span className="truncate opacity-70">· {reason}</span>}
    </div>
  );
}
