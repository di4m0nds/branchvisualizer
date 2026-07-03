// Shared presentation helpers for a Session row: dot color, relative time,
// and a `statusMeta` for the sidebar pill (colors + label).

import type { Session, SessionStatus } from '@/types/session';

export function statusDot(s: Session): string {
  return s.context.status === 'error' ? 'bg-red-400'
    : s.context.status === 'idle' ? 'bg-muted-foreground/40'
      : s.context.status === 'complete' ? 'bg-emerald-400'
        : s.context.status === 'planning' || s.context.status === 'pending_plan_approval' ? 'bg-violet-400'
          : s.context.status === 'awaiting_input' ? 'bg-violet-400'
            : s.context.status === 'awaiting_approval' ? 'bg-amber-400'
              : 'bg-cyan-400';
}

export function lastActivity(s: Session): string {
  const last = s.messages[s.messages.length - 1];
  if (!last) return 'no messages';
  const then = new Date(last.ts).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export interface StatusMeta {
  /** Short human label to show inside a pill. Empty for idle. */
  label: string;
  /** Tailwind classes for the pill (bg + border + text). */
  pillClass: string;
  /** Tailwind classes for the leading dot (bg). */
  dotClass: string;
  /** True when the pill should render (non-idle). */
  hasPill: boolean;
}

const IDLE_META: StatusMeta = {
  label: '',
  pillClass: '',
  dotClass: 'bg-muted-foreground/40',
  hasPill: false,
};

export function statusMeta(status: SessionStatus): StatusMeta {
  switch (status) {
    case 'idle':
      return IDLE_META;
    case 'running':
      return {
        label: 'Running',
        pillClass: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/25',
        dotClass: 'bg-cyan-400',
        hasPill: true,
      };
    case 'working':
      return {
        label: 'Working',
        pillClass: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/25',
        dotClass: 'bg-cyan-400',
        hasPill: true,
      };
    case 'planning':
      return {
        label: 'Planning',
        pillClass: 'bg-violet-500/10 text-violet-400 border border-violet-500/25',
        dotClass: 'bg-violet-400',
        hasPill: true,
      };
    case 'pending_plan_approval':
      return {
        label: 'Plan Ready',
        pillClass: 'bg-violet-500/10 text-violet-400 border border-violet-500/25',
        dotClass: 'bg-violet-400',
        hasPill: true,
      };
    case 'awaiting_approval':
      return {
        label: 'Approval',
        pillClass: 'bg-amber-500/10 text-amber-400 border border-amber-500/25',
        dotClass: 'bg-amber-400',
        hasPill: true,
      };
    case 'awaiting_input':
      return {
        label: 'Needs input',
        pillClass: 'bg-violet-500/10 text-violet-400 border border-violet-500/25',
        dotClass: 'bg-violet-400',
        hasPill: true,
      };
    case 'complete':
      return {
        label: 'Completed',
        pillClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
        dotClass: 'bg-emerald-400',
        hasPill: true,
      };
    case 'error':
      return {
        label: 'Error',
        pillClass: 'bg-red-500/10 text-red-400 border border-red-500/25',
        dotClass: 'bg-red-400',
        hasPill: true,
      };
    default:
      return IDLE_META;
  }
}
