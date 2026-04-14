import { useAppContext } from '@/store/AppContext';
import { AuthorCard } from '@/components/AuthorPopup';
import { cn, copyToClipboard } from '@/lib/utils';
import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';

export default function DetailPanel() {
  const { state, dispatch } = useAppContext();
  const { selectedNode, graphData } = state;
  const [copied, setCopied] = useState(false);

  if (!selectedNode) return null;

  const { commit, color } = selectedNode;
  const tags = graphData?.tagMap.get(commit.sha) ?? [];
  const branches = graphData?.branchMap.get(commit.sha) ?? [];
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

  async function handleCopySha() {
    await copyToClipboard(commit.sha);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <aside className="w-80 flex-shrink-0 flex flex-col border-l border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {/* SHA with copy button */}
          <button
            className="flex items-center gap-1 group"
            onClick={handleCopySha}
            title={copied ? 'Copied!' : `Copy full SHA: ${commit.sha}`}
          >
            <code
              className="text-sm font-mono font-semibold"
              style={{ color }}
            >
              {commit.shortSha}
            </code>
            <span className={cn(
              'text-[10px] transition-all scale-120',
              copied ? 'text-green-500' : 'text-muted-foreground opacity-0 group-hover:opacity-100'
            )}>
              {copied ? <CheckIcon className="w-3 h-3" /> : <CopyIcon className="w-3 h-3" />}
            </span>
          </button>

          {/* Merge badge */}
          {commit.isMerge && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium
                             bg-purple-500/10 border border-purple-500/30 text-purple-400">
              merge
            </span>
          )}

          {/* Branch badges */}
          {branches.slice(0, 2).map(b => (
            <span
              key={b.name}
              className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border truncate max-w-[90px]',
                b.isDefault
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                  : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
              )}
              title={b.name}
            >
              {b.name}
            </span>
          ))}
          {branches.length > 2 && (
            <span className="text-[10px] text-muted-foreground">+{branches.length - 2}</span>
          )}

          {/* Tag badges */}
          {tags.slice(0, 1).map(t => (
            <span
              key={t.name}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium
                         bg-amber-500/10 border border-amber-500/30 text-amber-500 truncate max-w-[90px]"
              title={t.name}
            >
              🏷 {t.name}
            </span>
          ))}
        </div>

        {/* Close */}
        <button
          className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={() => dispatch({ type: 'SELECT_NODE', node: null })}
          title="Close (Esc)"
          aria-label="Close detail panel"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col divide-y divide-border">
          {/* Commit message */}
          <div className="px-4 py-3 flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Commit message
            </span>
            <p className="text-sm font-medium text-foreground leading-snug">{commit.subject}</p>
            {commit.body && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed mt-1">
                {commit.body}
              </p>
            )}
          </div>

          {/* Author */}
          <div className="px-4 py-3">
            <AuthorCard author={commit.author} label="Author" />
          </div>

          {/* Stats */}
          {commit.stats && (
            <div className="px-4 py-3 flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Changes
              </span>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-500 font-mono font-semibold">
                  +{commit.stats.additions.toLocaleString()}
                </span>
                <span className="text-red-400 font-mono font-semibold">
                  −{commit.stats.deletions.toLocaleString()}
                </span>
                <span className="text-muted-foreground text-xs">
                  {commit.stats.total.toLocaleString()} files
                </span>
              </div>
              {/* Progress bar */}
              {commit.stats.total > 0 && (
                <div className="h-1 rounded-full overflow-hidden bg-muted flex mt-0.5">
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: `${(commit.stats.additions / (commit.stats.additions + commit.stats.deletions + 0.001)) * 100}%` }}
                  />
                  <div className="h-full bg-red-400 rounded-full flex-1" />
                </div>
              )}
            </div>
          )}

          {/* Parents */}
          {parentNodes.length > 0 && (
            <div className="px-4 py-3 flex flex-col gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {parentNodes.length === 1 ? 'Parent commit' : `Parent commits (${parentNodes.length})`}
              </span>
              <div className="flex flex-col gap-1">
                {parentNodes.map(pn => (
                  <button
                    key={pn.commit.sha}
                    className="flex items-start gap-2 text-left rounded-lg px-2 py-1.5
                               hover:bg-accent transition-colors group w-full"
                    onClick={() => selectParent(pn.commit.sha)}
                  >
                    <svg
                      className="flex-shrink-0 mt-0.5 opacity-60"
                      width="10" height="10" viewBox="0 0 16 16"
                      fill="none" stroke="currentColor" strokeWidth="2"
                      style={{ color: pn.color }}
                    >
                      <line x1="8" y1="14" x2="8" y2="2" />
                      <line x1="4" y1="6" x2="8" y2="2" />
                      <line x1="12" y1="6" x2="8" y2="2" />
                    </svg>
                    <div className="flex flex-col min-w-0">
                      <code className="text-xs font-mono" style={{ color: pn.color }}>
                        {pn.commit.shortSha}
                      </code>
                      <span className="text-xs text-muted-foreground truncate group-hover:text-foreground transition-colors">
                        {pn.commit.subject.slice(0, 52)}{pn.commit.subject.length > 52 ? '…' : ''}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* GitHub link */}
          <div className="px-4 py-3">
            <a
              href={ghUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground
                         hover:text-foreground transition-colors group"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61
                         c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1
                         S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77
                         a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
              </svg>
              View on GitHub
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none"
                stroke="currentColor" strokeWidth="1.5"
                className="opacity-60 group-hover:opacity-100 transition-opacity">
                <path d="M2 10L10 2M10 2H5M10 2v5" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </aside>
  );
}
