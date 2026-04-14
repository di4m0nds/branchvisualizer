import { useAppContext } from '../store/AppContext';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function DetailPanel() {
  const { state, dispatch } = useAppContext();
  const { selectedNode, graphData } = state;

  if (!selectedNode) {
    return (
      <aside className="detail-panel detail-panel--empty">
        <p className="detail-empty-hint">Click a commit to inspect it</p>
      </aside>
    );
  }

  const { commit } = selectedNode;
  const tags = graphData?.tagMap.get(commit.sha) ?? [];
  const branches = graphData?.branchMap.get(commit.sha) ?? [];
  const parentNodes = commit.parents.map(pSha => graphData?.commitMap.get(pSha)).filter(Boolean);

  const ghUrl = state.repoInfo
    ? `${state.repoInfo.url}/commit/${commit.sha}`
    : `https://github.com/commit/${commit.sha}`;

  return (
    <aside className="detail-panel">
      {/* Header */}
      <div className="detail-header">
        <div className="detail-header-row">
          <span className="detail-sha"
            title={commit.sha}
            style={{ color: selectedNode.color }}
          >
            {commit.shortSha}
          </span>
          {commit.isMerge && <span className="detail-badge detail-badge--merge">merge</span>}
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
              🏷 {t.name}
            </span>
          ))}
        </div>
        <button
          className="detail-close"
          onClick={() => dispatch({ type: 'SELECT_NODE', node: null })}
          title="Close (Esc)"
        >✕</button>
      </div>

      {/* Message */}
      <div className="detail-section">
        <p className="detail-subject">{commit.subject}</p>
        {commit.body && <pre className="detail-body">{commit.body}</pre>}
      </div>

      {/* Author */}
      <div className="detail-section">
        <div className="detail-author-row">
          {commit.author.avatarUrl && (
            <img
              src={commit.author.avatarUrl}
              alt={commit.author.name}
              className="detail-avatar"
              loading="lazy"
            />
          )}
          <div className="detail-author-info">
            <span className="detail-author-name">
              {commit.author.login
                ? <a href={`https://github.com/${commit.author.login}`} target="_blank" rel="noreferrer">{commit.author.name}</a>
                : commit.author.name
              }
            </span>
            <span className="detail-author-email">{commit.author.email}</span>
          </div>
          <div className="detail-date-col">
            <span className="detail-timeago" title={formatDate(commit.author.date)}>
              {timeAgo(commit.author.date)}
            </span>
            <span className="detail-date">{formatDate(commit.author.date)}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      {commit.stats && (
        <div className="detail-section detail-stats">
          <span className="detail-additions">+{commit.stats.additions}</span>
          <span className="detail-deletions">−{commit.stats.deletions}</span>
          <span className="detail-total">{commit.stats.total} changes</span>
        </div>
      )}

      {/* Parents */}
      {parentNodes.length > 0 && (
        <div className="detail-section">
          <p className="detail-label">Parent{parentNodes.length > 1 ? 's' : ''}</p>
          <div className="detail-parents">
            {parentNodes.map(pNode => pNode && (
              <button
                key={pNode.commit.sha}
                className="detail-parent-btn"
                style={{ color: pNode.color }}
                onClick={() => dispatch({ type: 'SELECT_NODE', node: pNode })}
              >
                {pNode.commit.shortSha}
                <span className="detail-parent-subject">
                  {pNode.commit.subject.slice(0, 50)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Links */}
      <div className="detail-section detail-links">
        <a href={ghUrl} target="_blank" rel="noreferrer" className="detail-link">
          View on GitHub ↗
        </a>
      </div>

      {/* Full SHA */}
      <div className="detail-section">
        <p className="detail-label">Full SHA</p>
        <code className="detail-full-sha"
          onClick={() => navigator.clipboard?.writeText(commit.sha)}
          title="Click to copy"
        >
          {commit.sha}
        </code>
      </div>
    </aside>
  );
}
