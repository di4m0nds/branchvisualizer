import { useState } from 'react';
import { AlertOctagon, ChevronDown, Stethoscope } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sendToChat } from '@/hooks/useSendToChat';
import { renderPrompt } from '@/lib/agent/prompts';
import { toast } from '@/services/toast';

// ─── Error triage card ───────────────────────────────────────────────────────
// Rendered when a run_command fails (nonzero exit / stack trace). "Diagnose"
// sends a structured prompt (editable in Settings → Prompts: triage_diagnose)
// back into the same session.

export default function ErrorTriageCard({ data, interactive }: {
  data: Record<string, unknown>;
  interactive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const command = String(data.command ?? '');
  const exitCode = data.exitCode === null || data.exitCode === undefined ? null : Number(data.exitCode);
  const flavor = data.flavor ? String(data.flavor) : null;
  const output = String(data.output ?? '');
  const sessionId = String(data.sessionId ?? '');

  const diagnose = () => {
    const prompt = renderPrompt('triage_diagnose', {
      command,
      exit_code: exitCode === null ? 'n/a (stack trace detected)' : String(exitCode),
      output,
    });
    if (!sendToChat(sessionId, prompt)) {
      toast.error('Chat unavailable', { description: 'Open the session to diagnose this failure.' });
    }
  };

  return (
    <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2.5 space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <AlertOctagon className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
        <span className="font-semibold text-red-400">
          Command failed{exitCode !== null ? ` (exit ${exitCode})` : ''}
        </span>
        {flavor && (
          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-red-500/10 border border-red-500/30 text-red-400">
            {flavor} trace
          </span>
        )}
        {interactive && (
          <button
            onClick={diagnose}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-red-500/40 text-[10px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            title="Ask the agent to diagnose and fix this failure"
          >
            <Stethoscope className="w-3 h-3" />
            Diagnose
          </button>
        )}
      </div>
      <code className="block text-[10px] font-mono text-muted-foreground truncate" title={command}>
        $ {command}
      </code>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('w-3 h-3 transition-transform', !open && '-rotate-90')} />
        output
      </button>
      {open && (
        <pre className="text-[10px] font-mono bg-background/60 border border-border rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
          {output}
        </pre>
      )}
    </div>
  );
}
