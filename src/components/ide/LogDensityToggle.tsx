import { Layers, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/store/AppContext';
import type { LogDensity } from '@/types';

// Switches the agent transcript between full-fidelity output ("verbose") and a
// condensed stream that keeps only file touches, executed commands, and the
// agent's high-level messages ("clean"). See AgentBlocks for the filtering.

const OPTIONS: { id: LogDensity; label: string; icon: React.ReactNode; title: string }[] = [
  { id: 'verbose', label: 'Verbose', icon: <Layers className="w-3 h-3" />, title: 'Show everything — raw logs, incremental adjustments' },
  { id: 'clean', label: 'Clean', icon: <List className="w-3 h-3" />, title: 'Show only file changes, commands, and agent messages' },
];

export default function LogDensityToggle() {
  const { state, dispatch } = useAppContext();
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded border border-border bg-muted/30">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          onClick={() => dispatch({ type: 'SET_LOG_DENSITY', density: o.id })}
          title={o.title}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
            state.logDensity === o.id
              ? 'bg-accent text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.icon}
          <span className="hidden md:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
