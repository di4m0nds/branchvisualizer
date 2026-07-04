import React, { useMemo, useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useAppSelector } from '@/store/store';
import type { CommitAuthor } from '@/types';
import { hashColor, getInitials, formatDate } from '@/lib/utils';

interface AuthorPopupProps {
  author: CommitAuthor;
  /** Bounding rect of the trigger element — used for fixed positioning */
  anchorRect: DOMRect;
}

export default function AuthorPopup({ author, anchorRect }: AuthorPopupProps) {
  const allCommits = useAppSelector((s) => s.allCommits);

  const stats = useMemo(() => {
    const key = author.login || author.email;
    let commits = 0;
    let firstDate = '';
    let lastDate  = '';
    for (const c of allCommits) {
      const ck = c.author.login || c.author.email;
      if (ck === key) {
        commits++;
        if (!firstDate || c.author.date < firstDate) firstDate = c.author.date;
        if (!lastDate  || c.author.date > lastDate)  lastDate  = c.author.date;
      }
    }
    const pct = allCommits.length > 0
      ? Math.round((commits / allCommits.length) * 100)
      : 0;
    return { commits, pct, firstDate, lastDate };
  }, [author, allCommits]);

  const color = hashColor(author.name);
  const initials = getInitials(author.name);

  // Position: above the anchor, left-aligned
  const POPUP_WIDTH = 224; // w-56 = 14rem = 224px
  const left = Math.min(anchorRect.left, window.innerWidth - POPUP_WIDTH - 8);
  const top  = anchorRect.top - 8; // will shift up with transform

  const profileUrl = author.login ? `https://github.com/${author.login}` : null;

  function openProfile(e: React.MouseEvent) {
    e.stopPropagation();
    if (profileUrl) window.open(profileUrl, '_blank', 'noreferrer');
  }

  return createPortal(
    <div
      className="fixed z-[9999] w-56 rounded-xl border border-border bg-popover shadow-xl
                 p-3 flex flex-col gap-3 pointer-events-none
                 animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
      style={{
        left,
        top,
        transform: 'translateY(-100%)',
      }}
    >
      {/* Header — clickable if GitHub login is known */}
      <div
        className={`flex items-center gap-2.5 pointer-events-auto rounded-lg -m-1 p-1
                   ${profileUrl ? 'cursor-pointer hover:bg-accent/60 transition-colors' : ''}`}
        onClick={openProfile}
        title={profileUrl ? `View @${author.login} on GitHub` : undefined}
      >
        {author.avatarUrl ? (
          <img
            src={author.avatarUrl}
            alt={author.name}
            className="w-8 h-8 rounded-full border border-border flex-shrink-0"
          />
        ) : (
          <div
            className="w-8 h-8 rounded-full border flex-shrink-0 flex items-center justify-center
                       text-xs font-semibold font-mono"
            style={{ background: `${color}22`, color, borderColor: `${color}60` }}
          >
            {initials}
          </div>
        )}
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-foreground truncate leading-tight">
            {author.name}
          </span>
          {author.login && (
            <span className="text-xs text-muted-foreground truncate">@{author.login}</span>
          )}
          {!author.login && author.email && (
            <span className="text-xs text-muted-foreground truncate">{author.email}</span>
          )}
        </div>
        {profileUrl && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
               className="ml-auto flex-shrink-0 opacity-40">
            <path d="M2 10L10 2M10 2H5M10 2v5"/>
          </svg>
        )}
      </div>

      <div className="border-t border-border" />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground tabular-nums">{stats.commits}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Commits</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground tabular-nums">{stats.pct}%</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Of total</span>
        </div>
        {stats.firstDate && (
          <div className="flex flex-col gap-0.5 col-span-2">
            <span className="text-xs font-medium text-foreground">
              {new Date(stats.firstDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
              {stats.lastDate && stats.lastDate !== stats.firstDate && (
                <span className="text-muted-foreground font-normal">
                  {' → '}
                  {new Date(stats.lastDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
                </span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Active period</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Hook: tracks anchor rect for portal-rendered popups ─────────────────────

export function useAnchorRect(active: boolean, ref: RefObject<HTMLElement | null>) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (active && ref.current) {
      setRect(ref.current.getBoundingClientRect());
    } else {
      setRect(null);
    }
  }, [active, ref]);

  return rect;
}

// ─── Standalone AuthorCard used in DetailPanel ────────────────────────────────

interface AuthorCardProps {
  author: CommitAuthor;
  label: string;
}

export function AuthorCard({ author, label }: AuthorCardProps) {
  const color = hashColor(author.name);
  const initials = getInitials(author.name);
  const profileUrl = author.login ? `https://github.com/${author.login}` : null;

  const inner = (
    <div className="flex items-center gap-2.5">
      {author.avatarUrl ? (
        <img
          src={author.avatarUrl}
          alt={author.name}
          className="w-7 h-7 rounded-full border border-border flex-shrink-0"
        />
      ) : (
        <div
          className="w-7 h-7 rounded-full border flex-shrink-0 flex items-center justify-center text-xs font-semibold"
          style={{ background: `${color}22`, color, borderColor: `${color}60` }}
        >
          {initials}
        </div>
      )}
      <div className="flex flex-col min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-medium text-foreground truncate">{author.name}</span>
          {author.login && (
            <span className="text-xs text-muted-foreground">@{author.login}</span>
          )}
        </div>
        {author.email && (
          <span className="text-xs text-muted-foreground truncate">{author.email}</span>
        )}
        <span className="text-xs text-muted-foreground" title={formatDate(author.date)}>
          {formatDate(author.date)}
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
      {profileUrl ? (
        <a
          href={profileUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg hover:bg-accent/60 transition-colors -mx-1 px-1 py-0.5"
          title={`View @${author.login} on GitHub`}
          onClick={e => e.stopPropagation()}
        >
          {inner}
        </a>
      ) : (
        inner
      )}
    </div>
  );
}
