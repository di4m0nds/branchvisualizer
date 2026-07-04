import { useState } from 'react';
import { ShieldAlert, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/services/toast';

// ─── CLI approval card ──────────────────────────────────────────────────────
// Surfaced when the Claude Code CLI failed one or more tool calls with
// "requires approval". Approve grants session-scoped bypass permissions and
// auto-resubmits the last user prompt so the work resumes.

export function CliApprovalCard({
  data, interactive, planningHint, onApprove,
}: {
  data: Record<string, unknown>;
  interactive: boolean;
  /** Extra footer line ("Approving will let the CLI finish writing your plan
   *  file") shown when we know the current session is in planning mode. */
  planningHint?: string;
  onApprove?: () => void;
}) {
  const [decided, setDecided] = useState<'approved' | 'denied' | null>(null);
  const reason = String(data.reason ?? 'The agent needs permission to run commands.');
  // Rows are `{ label, full }` — see hydrateApprovalCard in blocks.ts. Legacy
  // blobs (plain string[]) still render by upgrading each to `{ label, full }`.
  const rows: Array<{ label: string; full: string }> = Array.isArray(data.commands)
    ? (data.commands as unknown[]).map((c) =>
      typeof c === 'string' ? { label: c, full: c } : (c as { label: string; full: string }))
    : [];
  // Distinct source compounds — one per tool_use — for the "Copy compound"
  // affordance, so the user can grab exactly what the CLI tried to run.
  const distinctCompounds = Array.from(new Set(rows.map((r) => r.full)));
  const copyAll = async () => {
    if (distinctCompounds.length === 0) return;
    try {
      await navigator.clipboard.writeText(distinctCompounds.join('\n'));
      toast.success(distinctCompounds.length > 1 ? 'Copied compound commands' : 'Copied full command');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20">
        <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-foreground">
          {decided === 'approved' ? 'Approved · resuming' : decided === 'denied' ? 'Denied' : 'Approval needed'}
        </span>
        {distinctCompounds.length > 0 && (
          <button
            onClick={copyAll}
            title={distinctCompounds.join('\n')}
            className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Copy className="w-3 h-3" /> Copy {distinctCompounds.length > 1 ? 'compounds' : 'full'}
          </button>
        )}
      </div>
      <div className="p-3 space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed">{reason}</p>
        {rows.length > 0 && (
          <ul className="rounded border border-border/60 bg-background/60 px-2.5 py-1.5 space-y-0.5">
            {rows.map((r, i) => (
              <li
                key={i}
                title={r.full !== r.label ? `Part of: ${r.full}` : undefined}
                className="text-[11px] font-mono text-foreground/90 truncate"
              >
                <span className="text-muted-foreground/60 mr-1.5">$</span>{r.label}
              </li>
            ))}
          </ul>
        )}
        {decided === null && interactive && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-muted-foreground/60">
              Grants bypass for this session only. You can revoke by resetting the thread.
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="xs" variant="outline" onClick={() => setDecided('denied')}>Deny</Button>
              <Button
                size="xs"
                onClick={() => { setDecided('approved'); onApprove?.(); }}
              >
                Approve for session
              </Button>
            </div>
          </div>
        )}
        {planningHint && (
          <p className="text-[10px] text-muted-foreground/70 italic pt-0.5">{planningHint}</p>
        )}
      </div>
    </div>
  );
}
