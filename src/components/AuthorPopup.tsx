import { useMemo } from 'react';
import { useAppContext } from '../store/AppContext';
import type { CommitAuthor } from '../types';

interface AuthorPopupProps {
  author: CommitAuthor;
}

// Generate a deterministic color from a string
function hashColor(str: string): string {
  const palette = [
    '#00e5ff', '#00d4aa', '#a855f7', '#3b82f6',
    '#f472b6', '#10b981', '#f59e0b', '#60a5fa',
    '#34d399', '#e879f9', '#fb923c', '#38bdf8',
  ];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return palette[Math.abs(h) % palette.length];
}

export default function AuthorPopup({ author }: AuthorPopupProps) {
  const { state } = useAppContext();

  const stats = useMemo(() => {
    const key = author.login || author.email;
    let commits = 0;
    let firstDate = '';
    let lastDate  = '';
    for (const c of state.allCommits) {
      const ck = c.author.login || c.author.email;
      if (ck === key) {
        commits++;
        if (!firstDate || c.author.date < firstDate) firstDate = c.author.date;
        if (!lastDate  || c.author.date > lastDate)  lastDate  = c.author.date;
      }
    }
    const pct = state.allCommits.length > 0
      ? Math.round((commits / state.allCommits.length) * 100)
      : 0;
    return { commits, pct, firstDate, lastDate };
  }, [author, state.allCommits]);

  const color = hashColor(author.name);
  const initial = author.name.charAt(0).toUpperCase();

  return (
    <div className="author-popup">
      {/* Header */}
      <div className="author-popup-header">
        {author.avatarUrl ? (
          <img
            src={author.avatarUrl}
            alt={author.name}
            className="author-popup-avatar"
          />
        ) : (
          <div
            className="author-popup-initial"
            style={{ background: `${color}22`, color, borderColor: color }}
          >
            {initial}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <span className="author-popup-name">{author.name}</span>
          {author.login && (
            <span className="author-popup-handle">@{author.login}</span>
          )}
          {author.email && (
            <span className="author-popup-email">{author.email}</span>
          )}
        </div>
      </div>

      <div className="author-popup-divider" />

      {/* Stats grid */}
      <div className="author-popup-stats">
        <div className="author-popup-stat">
          <span className="author-popup-stat-value">{stats.commits}</span>
          <span className="author-popup-stat-label">Commits</span>
        </div>
        <div className="author-popup-stat">
          <span className="author-popup-stat-value">{stats.pct}%</span>
          <span className="author-popup-stat-label">Of total</span>
        </div>
        {stats.firstDate && (
          <div className="author-popup-stat" style={{ gridColumn: '1 / -1' }}>
            <span className="author-popup-stat-value" style={{ fontSize: '11px' }}>
              {new Date(stats.firstDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}
            </span>
            <span className="author-popup-stat-label">First commit</span>
          </div>
        )}
      </div>
    </div>
  );
}
