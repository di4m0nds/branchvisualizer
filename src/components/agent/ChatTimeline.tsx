import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Search, FileText, Pencil, Terminal, MessageSquare, Wrench, User, Bot, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';
import type { TimelineTurn, StepKind } from './blocks';

// One collapsible session timeline. Each turn is a row (user or agent); an agent
// turn expands to reveal its ordered step sub-timeline (thinking → tool calls →
// answer). Clicking a turn header or a step node scrolls the chat to the message
// it came from.

const STEP_ICON: Record<StepKind, React.ComponentType<{ className?: string }>> = {
  thinking: Brain,
  grep: Search,
  read_file: FileText,
  edit_file: Pencil,
  run_command: Terminal,
  tool: Wrench,
  answer: MessageSquare,
};

export default function ChatTimeline({
  turns, onScrollTo, activeMessageId,
}: {
  turns: TimelineTurn[];
  onScrollTo: (messageId: string) => void;
  activeMessageId?: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  if (turns.length === 0) {
    return (
      <div className="h-full flex items-center justify-center px-2 text-[10px] text-center text-muted-foreground/50">
        Timeline appears as you chat.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto py-2 px-1.5">
      <ol className="relative space-y-0.5">
        {turns.map((turn) => {
          const isUser = turn.role === 'user';
          const isOpen = expanded.has(turn.messageId);
          const hasSteps = turn.steps.length > 0;
          const RoleIcon = isUser ? User : Bot;
          return (
            <li key={turn.messageId}>
              <button
                onClick={() => { onScrollTo(turn.messageId); if (hasSteps && !isUser) toggle(turn.messageId); }}
                className={cn(
                  'group flex items-center gap-1.5 w-full text-left rounded px-1.5 py-1 transition-colors',
                  activeMessageId === turn.messageId ? 'bg-primary/10' : 'hover:bg-muted/40',
                )}
                title={isUser ? 'You' : 'Agent'}
              >
                {hasSteps && !isUser ? (
                  <ChevronRight className={cn('w-3 h-3 flex-shrink-0 text-muted-foreground/60 transition-transform', isOpen && 'rotate-90')} />
                ) : (
                  <span className="w-3 flex-shrink-0" />
                )}
                <RoleIcon className={cn('w-3 h-3 flex-shrink-0', isUser ? 'text-primary/70' : 'text-muted-foreground')} />
                <span className="text-[10px] font-mono text-muted-foreground/70 tabular-nums">{formatTime(turn.ts)}</span>
                {hasSteps && !isUser && (
                  <span className="ml-auto text-[9px] font-mono text-muted-foreground/40">{turn.steps.length}</span>
                )}
              </button>

              <AnimatePresence initial={false}>
                {isOpen && hasSteps && !isUser && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    className="overflow-hidden ml-[13px] border-l border-border/60 pl-2 py-0.5 space-y-0.5"
                  >
                    {turn.steps.map((step, i) => {
                      const Icon = STEP_ICON[step.kind];
                      return (
                        <li key={`${step.messageId}-${i}`}>
                          <button
                            onClick={() => onScrollTo(step.messageId)}
                            title={step.label}
                            className="flex items-center gap-1.5 w-full text-left rounded px-1 py-0.5 hover:bg-muted/40 transition-colors"
                          >
                            <Icon className={cn('w-3 h-3 flex-shrink-0',
                              step.status === 'error' ? 'text-red-400' : 'text-muted-foreground/70')} />
                            <span className="text-[10px] text-muted-foreground/80 truncate">{step.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </motion.ul>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
