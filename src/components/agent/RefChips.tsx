// ─── Attached-reference chips ───────────────────────────────────────────────
// Pills rendered on a sent user bubble, one per resolved `@path` reference.
// Color encodes resolution status: normal = inlined, amber = truncated,
// red/strikethrough = failed (deleted, binary, over budget).

import { AlertTriangle, FileText, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageRef } from '@/types/session';

export default function RefChips({ refs }: { refs: MessageRef[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-1.5">
      {refs.map((r) => {
        const isErr = r.status === 'error';
        const isTrunc = r.status === 'truncated';
        const Icon = isErr ? AlertTriangle : r.kind === 'folder' ? Folder : FileText;
        const name = r.path.slice(r.path.lastIndexOf('/') + 1);
        return (
          <span
            key={`${r.path}:${r.note ?? ''}`}
            title={`${r.path}${r.note ? ` — ${r.note}` : ''}`}
            className={cn(
              'inline-flex items-center gap-1 max-w-56 rounded-full border px-2 py-0.5 text-[10px] font-mono',
              isErr
                ? 'border-red-400/40 bg-red-400/10 text-red-400/90'
                : isTrunc
                  ? 'border-amber-400/40 bg-amber-400/10 text-amber-300/90'
                  : 'border-primary/30 bg-primary/10 text-primary/90',
            )}
          >
            <Icon className="w-2.5 h-2.5 shrink-0" />
            <span className={cn('truncate', isErr && 'line-through')}>
              {name}{r.kind === 'folder' ? '/' : ''}
            </span>
          </span>
        );
      })}
    </div>
  );
}
