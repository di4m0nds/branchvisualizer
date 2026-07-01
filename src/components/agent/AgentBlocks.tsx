import { cn } from '@/lib/utils';
import type { AgentBlock } from '@/types/session';

// Renders the structured blocks parsed from an assistant message.

function ActionLog({ data }: { data: Record<string, unknown> }) {
  const status = String(data.status ?? 'complete');
  const output = String(data.output ?? '');
  return (
    <div className={cn(
      'rounded-md border text-xs overflow-hidden',
      status === 'error' ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-muted/20',
    )}>
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/50">
        <span className={cn('w-1.5 h-1.5 rounded-full', status === 'error' ? 'bg-red-400' : 'bg-green-400')} />
        <span className="font-mono text-[11px] text-foreground">{String(data.tool)}</span>
        <span className="text-muted-foreground truncate">{String(data.description)}</span>
      </div>
      {output && (
        <pre className="px-2.5 py-1.5 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap max-h-40 overflow-auto">
          {output}
        </pre>
      )}
    </div>
  );
}

function LabeledCard({ label, tone, inner }: { label: string; tone?: string; inner: string }) {
  return (
    <div className={cn('rounded-md border border-border bg-muted/10 overflow-hidden')}>
      <div className={cn('px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border-b border-border/50', tone ?? 'text-muted-foreground')}>
        {label}
      </div>
      <pre className="px-2.5 py-1.5 text-[11px] font-mono text-foreground/90 whitespace-pre-wrap max-h-64 overflow-auto">
        {inner}
      </pre>
    </div>
  );
}

function CodeBlock({ inner }: { inner: string }) {
  return (
    <pre className="rounded-md border border-border bg-[#0a0a0a] text-[#e4e4e7] px-2.5 py-2 text-[11px] font-mono whitespace-pre overflow-auto max-h-80">
      {inner}
    </pre>
  );
}

function BlockView({ block }: { block: AgentBlock }) {
  const inner = String(block.data?.inner ?? '');

  switch (block.type) {
    case 'text':
      return <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{block.raw}</p>;
    case 'action_log':
      return <ActionLog data={block.data ?? {}} />;
    case 'plan':
      return <LabeledCard label="Plan" tone="text-primary" inner={inner} />;
    case 'agent_status':
      return <LabeledCard label="Status" inner={inner} />;
    case 'session_state_change':
      return <LabeledCard label="State change" inner={block.raw} />;
    case 'context_warning':
      return <LabeledCard label="Context warning" tone="text-amber-500" inner={inner} />;
    case 'security_review':
      return <LabeledCard label="Security review" tone="text-red-400" inner={inner} />;
    case 'change_explanation':
      return <LabeledCard label="What changed" tone="text-green-500" inner={inner} />;
    case 'file_changes':
    case 'editor_sync':
    case 'branch_visualizer_refresh':
    case 'nvim_command':
      return <LabeledCard label={block.type.replace(/_/g, ' ')} inner={inner} />;
    case 'code_file':
    case 'code_diff':
      return <CodeBlock inner={inner} />;
    default:
      return <LabeledCard label={block.type} inner={inner || block.raw} />;
  }
}

export default function AgentBlocks({ blocks }: { blocks: AgentBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) => <BlockView key={i} block={b} />)}
    </div>
  );
}
