import { Wrench } from 'lucide-react';
import type { StatusFile, StatusCommand } from '../blocks';
import CodeFrame from '../CodeFrame';

// ─── Status heartbeat card ───────────────────────────────────────────────────

export function StatusCard({ data }: { data: Record<string, unknown> }) {
  const files = (data.files as StatusFile[] | undefined) ?? [];
  const commands = (data.commands as StatusCommand[] | undefined) ?? [];
  const messages = (data.messages as string[] | undefined) ?? [];
  const state = String(data.state ?? '');
  const currentStep = String(data.currentStep ?? '');
  // Pure-noise heartbeat (all sections empty) — render nothing.
  if (!files.length && !commands.length && !messages.length && !state && !currentStep) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border/40">
        <Wrench className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
        {state && <span className="ml-auto text-[10px] text-foreground/70">{state}{currentStep ? ` · ${currentStep}` : ''}</span>}
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[10px] font-mono rounded bg-background/60 border border-border/40 px-1.5 py-0.5">
                {f.action && <span className="text-muted-foreground">{f.action}</span>}
                <span className="text-foreground/80 truncate max-w-[200px]" title={f.path}>{f.path}</span>
              </span>
            ))}
          </div>
        )}
        {commands.map((c, i) => <CodeFrame key={i} code={c.cmd} className="my-0.5" />)}
        {messages.map((mtext, i) => <div key={i} className="text-[11px] text-foreground/80 leading-relaxed">{mtext}</div>)}
      </div>
    </div>
  );
}
