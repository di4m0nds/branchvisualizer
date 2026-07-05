import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ─── Pending-action approval card ────────────────────────────────────────────
// A supervised-mode API model proposes an action as a <pending_action> block and
// pauses. This renders it as an interactive card; approving/rejecting continues
// the turn via a follow-up prompt (wired in ChatPanel). Only the latest, settled
// assistant message gets live buttons (`interactive`).
export function PendingActionBlockCard({
  data, interactive, onDecision,
}: {
  data: Record<string, unknown>;
  interactive: boolean;
  onDecision?: (decision: 'approve' | 'reject') => void;
}) {
  const [decided, setDecided] = useState<'approve' | 'reject' | null>(null);
  const actionType = String(data.actionType ?? 'action').replace(/_/g, ' ');
  const description = String(data.description ?? '');
  const command = String(data.command ?? '');
  const files = String(data.filesAffected ?? '');
  const risk = String(data.risk ?? 'low');
  const reason = String(data.reason ?? '');
  const riskTone = risk === 'high' ? 'text-red-400 border-red-400/40 bg-red-400/10'
    : risk === 'medium' ? 'text-amber-400 border-amber-400/40 bg-amber-400/10'
      : 'text-green-400 border-green-400/40 bg-green-400/10';

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/20">
        <ShieldAlert className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="text-xs font-semibold text-foreground">
          {decided === 'approve' ? 'Approved · continuing' : decided === 'reject' ? 'Rejected' : 'Approval needed'}
        </span>
        <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60">{actionType}</span>
        <span className={cn('ml-auto px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider', riskTone)}>
          {risk} risk
        </span>
      </div>
      <div className="p-3 space-y-2">
        {description && <p className="text-xs text-foreground/90 leading-relaxed">{description}</p>}
        {command && (
          <pre className="text-[11px] font-mono bg-background/60 rounded border border-border px-2.5 py-1.5 overflow-auto">
            <span className="text-muted-foreground/50 mr-1.5">$</span>{command}
          </pre>
        )}
        {files && (
          <p className="text-[10px] text-muted-foreground/70">
            <span className="uppercase tracking-wider mr-1.5 text-muted-foreground/50">files</span>
            <span className="font-mono text-foreground/80">{files}</span>
          </p>
        )}
        {reason && <p className="text-[11px] text-muted-foreground/70 italic leading-relaxed">{reason}</p>}
        {decided === null && interactive && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button size="xs" variant="outline" onClick={() => { setDecided('reject'); onDecision?.('reject'); }}>
              Reject
            </Button>
            <Button size="xs" onClick={() => { setDecided('approve'); onDecision?.('approve'); }}>
              Approve &amp; continue
            </Button>
          </div>
        )}
        {decided === null && !interactive && (
          <p className="text-[10px] text-muted-foreground/40 pt-0.5">Approve on the latest turn to continue.</p>
        )}
      </div>
    </div>
  );
}
