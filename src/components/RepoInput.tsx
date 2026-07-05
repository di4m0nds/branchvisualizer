import { useState, type FormEvent } from 'react';
import { useAppDispatch, useAppSelector } from '../store/store';
import { useRepoData } from '../hooks/useRepoData';
import { parseGitHubURL } from '../lib/parser';

const EXAMPLE_REPOS = [
  'facebook/react',
  'torvalds/linux',
  'microsoft/vscode',
  'vercel/next.js',
];

export default function RepoInput() {
  const dispatch = useAppDispatch();
  const loadState = useAppSelector((s) => s.loadState);
  const token = useAppSelector((s) => s.token);
  const rateLimit = useAppSelector((s) => s.rateLimit);
  const graphData = useAppSelector((s) => s.graphData);
  const { loadRepo } = useRepoData();
  const [url, setUrl] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [urlError, setUrlError] = useState('');

  const isLoading = ['fetching-repo', 'fetching-branches', 'fetching-commits', 'building-graph', 'validating'].includes(loadState.phase);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setUrlError('Please enter a GitHub repository URL');
      return;
    }
    const parsed = parseGitHubURL(trimmed);
    if (!parsed) {
      setUrlError('Not a valid GitHub URL — try: https://github.com/owner/repo');
      return;
    }
    setUrlError('');
    loadRepo(trimmed);
  };

  const handleExample = (repo: string) => {
    setUrl(`https://github.com/${repo}`);
    setUrlError('');
    loadRepo(`https://github.com/${repo}`);
  };

  return (
    <div className="repo-input-area">
      <form className="repo-form" onSubmit={handleSubmit}>
        {/* URL input */}
        <div className={`repo-input-wrap${urlError ? ' repo-input-wrap--error' : ''}`}>
          <span className="repo-input-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
            </svg>
          </span>
          <input
            type="text"
            className="repo-input"
            placeholder="https://github.com/owner/repository"
            value={url}
            onChange={e => { setUrl(e.target.value); setUrlError(''); }}
            disabled={isLoading}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            aria-label="GitHub repository URL"
          />
          {url && !isLoading && (
            <button
              type="button"
              className="repo-input-clear"
              onClick={() => { setUrl(''); setUrlError(''); dispatch({ type: 'RESET' }); }}
            >✕</button>
          )}
        </div>

        <button type="submit" className="repo-submit-btn" disabled={isLoading}>
          {isLoading ? (
            <span className="btn-spinner" />
          ) : 'Visualize'}
        </button>

        {/* Token toggle */}
        <button
          type="button"
          className={`token-toggle-btn${token ? ' token-toggle-btn--active' : ''}`}
          onClick={() => setShowToken(v => !v)}
          title="GitHub Personal Access Token (raises API rate limit from 60 to 5000 req/hr)"
        >
          🔑
        </button>
      </form>

      {/* Token input (collapsed by default) */}
      {showToken && (
        <div className="token-input-row">
          <input
            type="password"
            className="token-input"
            placeholder="GitHub Personal Access Token (optional — raises rate limit)"
            value={token}
            onChange={e => dispatch({ type: 'SET_TOKEN', token: e.target.value })}
            autoComplete="off"
          />
          {token && (
            <span className="token-status">✓ Token set ({rateLimit ? `${rateLimit.remaining}/${rateLimit.limit} requests left` : 'not tested yet'})</span>
          )}
          <a
            href="https://github.com/settings/tokens"
            target="_blank"
            rel="noreferrer"
            className="token-help-link"
          >
            Get a token ↗
          </a>
        </div>
      )}

      {/* URL error */}
      {urlError && <p className="repo-url-error">{urlError}</p>}

      {/* Examples */}
      {!graphData && !isLoading && (
        <div className="repo-examples">
          <span className="repo-examples-label">Try:</span>
          {EXAMPLE_REPOS.map(r => (
            <button
              key={r}
              className="repo-example-btn"
              onClick={() => handleExample(r)}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {/* Rate limit info */}
      {rateLimit && (
        <div className={`rate-limit-info${rateLimit.remaining < 10 ? ' rate-limit-info--warn' : ''}`}>
          API: {rateLimit.remaining}/{rateLimit.limit} requests remaining
          {rateLimit.remaining < 10 && ` · resets ${rateLimit.resetAt.toLocaleTimeString()}`}
        </div>
      )}
    </div>
  );
}
