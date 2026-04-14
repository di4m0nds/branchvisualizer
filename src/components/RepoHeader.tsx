import { useAppContext } from '../store/AppContext';

export default function RepoHeader() {
  const { state } = useAppContext();
  const { repoInfo } = state;

  if (!repoInfo) return null;

  return (
    <div className="repo-header">
      <a
        href={repoInfo.url}
        target="_blank"
        rel="noreferrer"
        className="repo-header-link"
      >
        <span className="repo-header-name">{repoInfo.fullName}</span>
        <span className="repo-header-arrow">↗</span>
      </a>
      {repoInfo.description && (
        <span className="repo-header-desc">{repoInfo.description}</span>
      )}
      <div className="repo-header-meta">
        <span className="repo-meta-item">⭐ {repoInfo.starCount.toLocaleString()}</span>
        <span className="repo-meta-item">⑂ {repoInfo.forkCount.toLocaleString()}</span>
        <span className="repo-meta-item repo-meta-branch">
          ⎇ {repoInfo.defaultBranch}
        </span>
        {repoInfo.pushedAt && (
          <span className="repo-meta-item">
            Last push: {new Date(repoInfo.pushedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}
