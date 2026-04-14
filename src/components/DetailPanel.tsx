import { useState } from 'react';
import { useAppContext } from '../store/AppContext';
import AuthorPopup from './AuthorPopup';

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

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

// ─── Author row with hover popup ──────────────────────────────────────────

type AuthorLike = { name: string; email: string; date: string; login?: string; avatarUrl?: string };

function AuthorRow({ author, label }: { author: AuthorLike; label: string }) {
  const [showPopup, setShowPopup] = useState(false);
  const color = hashColor(author.name);
  const initial = author.name.charAt(0).toUpperCase();

  return (
    <div className="detail-section">
      <div className="detail-section-label">{label}</div>
      <div className="detail-author-row">
        <div
          className="author-popup-wrapper"
          onMouseEnter={() => setShowPopup(true)}
          onMouseLeave={() => setShowPopup(false)}
        >
          {author.avatarUrl ? (
            <img
              src={author.avatarUrl}
              alt={author.name}
              className="detail-author-avatar"
            />
          ) : (
            <div
              className="detail-author-initial-avatar"
              style={{ background: `${color}22`, color, borderColor: color }}
            >
              {initial}
            </div>
          )}
          {showPopup && <AuthorPopup author={author} />}
        </div>

        <div className="detail-author-info">
          <span
            className="detail-author-name"
            onMouseEnter={() => setShowPopup(true)}
            onMouseLeave={() => setShowPopup(false)}
          >
            {author.name}
            {author.login && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6, fontSize: 10 }}>
                @{author.login}
              </span>
            )}
          </span>
          {author.email && (
            <span className="detail-author-email">{author.email}</span>
          )}
          <span className="detail-author-date" title={formatDate(author.date)}>
            {timeAgo(author.date)} · {formatDate(author.date)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main DetailPanel ─────────────────────────────────────────────────────

export default function DetailPanel() {
  const { state, dispatch } = useAppContext();
  const { selectedNode, graphData } = state;

  if (!selectedNode) {
    return (
      <aside className="detail-panel detail-panel--empty">
        <p className="detail-empty-hint">
          ↙ Click a commit in the {state.viewMode === 'canvas' ? 'graph' : 'list'} to inspect it
        </p>
      </aside>
    );
  }

  const { commit } = selectedNode;
  const tags        = graphData?.tagMap.get(commit.sha) ?? [];
  const branches    = graphData?.branchMap.get(commit.sha) ?? [];
  const parentNodes = commit.parents
    .map(pSha => graphData?.commitMap.get(pSha))
    .filter((n): n is NonNullable<typeof n> => !!n);

  const ghUrl = state.repoInfo
    ? `${state.repoInfo.url}/commit/${commit.sha}`
    : `https://github.com/commit/${commit.sha}`;

  function selectParent(sha: string) {
    if (!graphData) return;
    const node = graphData.commitMap.get(sha);
    if (node) dispatch({ type: 'SELECT_NODE', node });
  }

  return (
    <aside className="detail-panel">
      {/* ── Header ── */}
      <div className="detail-header">
        <div className="detail-header-row">
          <span className="detail-sha" style={{ color: selectedNode.color }} title={commit.sha}>
            {commit.shortSha}
          </span>
          {commit.isMerge && (
            <span className="detail-badge detail-badge--merge">merge</span>
          )}
          {branches.map(b => (
            <span
              key={b.name}
              className={`detail-badge detail-badge--branch${b.isDefault ? ' detail-badge--default' : ''}`}
            >
              {b.name}
            </span>
          ))}
          {tags.map(t => (
            <span key={t.name} className="detail-badge detail-badge--tag">
              {t.name}
            </span>
          ))}
        </div>
        <button
          className="detail-close"
          onClick={() => dispatch({ type: 'SELECT_NODE', node: null })}
          title="Close (Esc)"
          aria-label="Close detail panel"
        >
          ✕
        </button>
      </div>

      <div className="detail-scroll">
        {/* ── Message ── */}
        <div className="detail-section">
          <div className="detail-section-label">Commit message</div>
          <p className="detail-message-subject">{commit.subject}</p>
          {commit.body && (
            <p className="detail-message-body">{commit.body}</p>
          )}
        </div>

        {/* ── Author ── */}
        <AuthorRow author={commit.author} label="Author" />

        {/* ── Stats ── */}
        {commit.stats && (
          <div className="detail-section">
            <div className="detail-section-label">Changes</div>
            <div className="detail-stats-row">
              <span className="detail-stat detail-stat--add">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <rect x="4" y="0" width="2" height="10"/>
                  <rect x="0" y="4" width="10" height="2"/>
                </svg>
                +{commit.stats.additions.toLocaleString()}
              </span>
              <span className="detail-stat detail-stat--del">
                <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor">
                  <rect width="10" height="2"/>
                </svg>
                −{commit.stats.deletions.toLocaleString()}
              </span>
              <span className="detail-stat detail-stat--total">
                Σ {commit.stats.total.toLocaleString()} files
              </span>
            </div>
          </div>
        )}

        {/* ── Parents ── */}
        {parentNodes.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-label">
              {parentNodes.length === 1 ? 'Parent' : `Parents (${parentNodes.length})`}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {parentNodes.map(pn => (
                <button
                  key={pn.commit.sha}
                  className="detail-parent-link"
                  onClick={() => selectParent(pn.commit.sha)}
                  style={{ color: pn.color }}
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="8" y1="14" x2="8" y2="2"/>
                    <line x1="4" y1="6" x2="8" y2="2"/>
                    <line x1="12" y1="6" x2="8" y2="2"/>
                  </svg>
                  {pn.commit.shortSha}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                    {' '}— {pn.commit.subject.slice(0, 38)}{pn.commit.subject.length > 38 ? '…' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── GitHub link ── */}
        <div className="detail-section">
          <a
            href={ghUrl}
            target="_blank"
            rel="noreferrer"
            className="detail-github-link"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
            </svg>
            View on GitHub ↗
          </a>
        </div>
      </div>
    </aside>
  );
}
