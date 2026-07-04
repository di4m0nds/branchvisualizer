import { useState } from 'react';
import FileLink from '@/components/FileLink';
import {
  Sparkles, FileEdit, FilePlus, FileMinus, FileText as FileTextIcon,
  Bug, ShieldCheck, ClipboardList, Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/services/toast';
import type { TaskSummaryFile } from '../blocks';
import Markdown from '../Markdown';

// ─── Task summary card ──────────────────────────────────────────────────────
// Structured wrap-up the model emits at the end of non-trivial turns. Renders
// as a distinct footer card with sectioned headings so a reviewer can scan
// what was done without re-reading the whole transcript.

const FILE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  added: FilePlus,
  modified: FileEdit,
  deleted: FileMinus,
};
const FILE_CHIP: Record<string, string> = {
  added: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  modified: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  deleted: 'text-red-400 bg-red-500/10 border-red-500/25',
};

export function TaskSummaryCard({ data }: { data: Record<string, unknown> }) {
  const whatWasDone = String(data.whatWasDone ?? '');
  const rootCause = String(data.rootCause ?? '');
  const features = String(data.features ?? '');
  const notes = String(data.notes ?? '');
  const files = (Array.isArray(data.files) ? data.files : []) as TaskSummaryFile[];
  const commands = (Array.isArray(data.commands) ? data.commands : []) as string[];

  const [showAllFiles, setShowAllFiles] = useState(false);
  const shownFiles = showAllFiles ? files : files.slice(0, 10);

  const copyAll = async () => {
    if (!commands.length) return;
    try {
      await navigator.clipboard.writeText(commands.join('\n'));
      toast.success('Copied verification commands');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/20">
        <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="text-xs font-semibold text-foreground">Task summary</span>
      </div>
      <div className="p-3 space-y-3">
        {whatWasDone && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">What was done</p>
            <Markdown text={whatWasDone} />
          </div>
        )}

        {files.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Files</p>
            <ul className="rounded border border-border/60 bg-background/40 divide-y divide-border/40">
              {shownFiles.map((f, i) => {
                const Icon = FILE_ICON[f.change] || FileTextIcon;
                const chip = FILE_CHIP[f.change] || 'text-muted-foreground bg-muted/30 border-border';
                return (
                  <li key={i} className="flex items-start gap-2 px-2.5 py-1.5 text-xs">
                    <Icon className="w-3 h-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <FileLink path={f.path} className="text-foreground/90 truncate flex-shrink min-w-0" />
                    <span className={cn(
                      'px-1.5 py-[1px] rounded text-[10px] font-medium leading-none border flex-shrink-0',
                      chip,
                    )}>
                      {f.change}
                    </span>
                    {f.description && (
                      <span className="text-muted-foreground truncate flex-1 min-w-0">— {f.description}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {files.length > 10 && !showAllFiles && (
              <button
                onClick={() => setShowAllFiles(true)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                +{files.length - 10} more…
              </button>
            )}
          </div>
        )}

        {rootCause && (
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">
              <Bug className="w-3 h-3" /> Root cause
            </p>
            <Markdown text={rootCause} />
          </div>
        )}

        {features && (
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="w-3 h-3" /> Features
            </p>
            <Markdown text={features} />
          </div>
        )}

        {commands.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                <ShieldCheck className="w-3 h-3" /> Verification
              </p>
              <button
                onClick={copyAll}
                title="Copy all commands"
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Copy className="w-3 h-3" /> Copy all
              </button>
            </div>
            <ul className="rounded border border-border/60 bg-background/40 divide-y divide-border/40">
              {commands.map((c, i) => (
                <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono">
                  <span className="text-muted-foreground/60">$</span>
                  <span className="text-foreground/90 truncate flex-1">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {notes && (
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <ClipboardList className="w-3 h-3" /> Notes
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
