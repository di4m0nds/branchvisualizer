// Comment thread for one plan section: existing comments (with resolve/delete)
// plus a small composer to add a new one.

import { useState } from 'react';
import { Check, Trash2, MessageSquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/time';
import type { PlanComment } from '@/types/session';

interface Props {
  comments: PlanComment[];
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
  onResolveToggle: (id: string) => void;
}

export default function PlanComments({ comments, onAdd, onRemove, onResolveToggle }: Props) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  function commit() {
    const t = value.trim();
    if (t) onAdd(t);
    setValue('');
    setAdding(false);
  }

  return (
    <div className="space-y-1.5">
      {comments.map((c) => (
        <div
          key={c.id}
          className={cn(
            'group/comment rounded-md border px-2.5 py-1.5 text-xs',
            c.resolved
              ? 'border-border/40 bg-muted/10 opacity-70'
              : 'border-amber-500/25 bg-amber-500/5',
          )}
        >
          <div className="flex items-start gap-2">
            <p className={cn('flex-1 min-w-0 whitespace-pre-wrap leading-relaxed text-foreground/90', c.resolved && 'line-through')}>
              {c.text}
            </p>
            <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/comment:opacity-100 transition-opacity">
              <button
                onClick={() => onResolveToggle(c.id)}
                title={c.resolved ? 'Mark unresolved' : 'Mark resolved'}
                className="p-0.5 rounded text-muted-foreground hover:text-emerald-400 hover:bg-accent/40"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={() => onRemove(c.id)}
                title="Delete comment"
                className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          <time className="text-[10px] font-mono text-muted-foreground/40">{formatTime(c.createdAt)}</time>
        </div>
      ))}

      {adding ? (
        <div className="space-y-1.5">
          <textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
              else if (e.key === 'Escape') { e.preventDefault(); setValue(''); setAdding(false); }
            }}
            placeholder="Add a comment… (Ctrl/⌘+Enter to save)"
            className="w-full h-16 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={commit}
              disabled={!value.trim()}
              className="px-2 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-medium disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => { setValue(''); setAdding(false); }}
              className="px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        // Full button treatment (not a text link) so first-time reviewers see
        // that per-section commenting is a real affordance.
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setAdding(true)}
          className="text-muted-foreground hover:text-foreground -ml-1.5"
        >
          <MessageSquarePlus className="w-3 h-3 mr-1" /> Comment on this section
        </Button>
      )}
    </div>
  );
}
