import { useAppContext } from '@/store/AppContext';
import { AuthorCard } from '@/components/AuthorPopup';
import { cn, copyToClipboard } from '@/lib/utils';
import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';

// ─── PR number extraction ─────────────────────────────────────────────────────

function extractPRNumber(subject: string, body: string): string | null {
  const combined = `${subject} ${body}`;
  const m = combined.match(/(?:pull\s+request\s+#|pr\s*#|\(#|(?:^|\s)#)(\d+)/i);
  return m ? m[1] : null;
}

// ─── Shared header ────────────────────────────────────────────────────────────

interface HeaderProps {
  mode: 'floating' | 'inline';
  minimized: boolean;
  onMinimize: () => void;
}

function PanelHeader({ mode, minimized, onMinimize }: HeaderProps) {
  const { state, dispatch } = useAppContext();
  const { selectedNode, graphData, repoInfo } = state;
  const [copied, setCopied] = useState(false);

  if (!selectedNode) return null;

  const { commit, color } = selectedNode;
  const tags = graphData?.tagMap.get(commit.sha) ?? [];
  const branches = graphData?.branchMap.get(commit.sha) ?? [];
  const prNumber = commit.isMerge ? extractPRNumber(commit.subject, commit.body) : null;
  const prUrl = prNumber && repoInfo ? `${repoInfo.url}/pull/${prNumber}` : null;

  async function handleCopy() {
    await copyToClipboard(commit.sha);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={cn(
      'flex items-center gap-2 flex-shrink-0 border-b border-border',
      mode === 'floating' ? 'px-4 py-3' : 'px-3 py-2',
    )}>
      {/* Left: SHA + badges */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
        {/* SHA chip */}
        <button
          onClick={handleCopy}
          title={copied ? 'Copied!' : `Copy SHA: ${commit.sha}`}
          className="flex items-center gap-1 group flex-shrink-0"
        >
          <code className="text-sm font-mono font-bold tracking-wide" style={{ color }}>
            {commit.shortSha}
          </code>
          <span className={cn(
            'transition-opacity',
            copied ? 'text-green-400 opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-70'
          )}>
            {copied ? <CheckIcon className="w-3 h-3" /> : <CopyIcon className="w-3 h-3" />}
          </span>
        </button>

        {/* Merge + PR */}
        {commit.isMerge && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium
                           bg-purple-500/10 border border-purple-500/25 text-purple-400 flex-shrink-0">
            merge
          </span>
        )}
        {prUrl && (
          <a href={prUrl} target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium flex-shrink-0
                       bg-purple-500/10 border border-purple-500/25 text-purple-400
                       hover:bg-purple-500/20 transition-colors flex items-center gap-0.5"
          >
            #{prNumber}
            <svg width="7" height="7" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 10L10 2M10 2H5M10 2v5"/>
            </svg>
          </a>
        )}

        {/* Branch badges */}
        {branches.slice(0, 2).map(b => (
          <span key={b.name}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border truncate max-w-[80px] flex-shrink-0"
            style={{ color, borderColor: `${color}45`, background: `${color}12` }}
            title={b.name}
          >
            {b.name}
          </span>
        ))}
        {branches.length > 2 && (
          <span className="text-[10px] text-muted-foreground flex-shrink-0">+{branches.length - 2}</span>
        )}

        {/* Tag badges */}
        {tags.slice(0, 1).map(t => (
          <span key={t.name}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium flex-shrink-0
                       bg-amber-500/10 border border-amber-500/25 text-amber-500 truncate max-w-[80px]"
            title={t.name}
          >
            🏷 {t.name}
          </span>
        ))}
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
        {mode === 'floating' && (
          <button
            onClick={onMinimize}
            title={minimized ? 'Expand' : 'Minimize'}
            className="w-5 h-5 rounded flex items-center justify-center
                       text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {minimized ? (
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <path d="M2 6.5l3-3 3 3"/>
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <line x1="1.5" y1="5" x2="8.5" y2="5"/>
              </svg>
            )}
          </button>
        )}
        <button
          onClick={() => dispatch({ type: 'SELECT_NODE', node: null })}
          title="Close (Esc)"
          className="w-5 h-5 rounded flex items-center justify-center
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="1" y1="1" x2="9" y2="9"/>
            <line x1="9" y1="1" x2="1" y2="9"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Floating panel body (vertical, scrollable) ───────────────────────────────

function FloatingBody() {
  const { state, dispatch } = useAppContext();
  const { selectedNode, graphData, repoInfo } = state;

  if (!selectedNode) return null;
  const { commit } = selectedNode;
  const parentNodes = commit.parents
    .map(sha => graphData?.commitMap.get(sha))
    .filter((n): n is NonNullable<typeof n> => !!n);
  const ghUrl = repoInfo ? `${repoInfo.url}/commit/${commit.sha}` : `https://github.com/commit/${commit.sha}`;

  function selectParent(sha: string) {
    if (!graphData) return;
    const node = graphData.commitMap.get(sha);
    if (node) { dispatch({ type: 'SELECT_NODE', node }); dispatch({ type: 'SCROLL_TO_SHA', sha }); }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col divide-y divide-border">
        {/* Message */}
        <div className="px-4 py-3 flex flex-col gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Commit message</span>
          <p className="text-sm font-medium text-foreground leading-snug">{commit.subject}</p>
          {commit.body && (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed mt-1 border-l-2 border-border pl-2">
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
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Changes</span>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-green-400 font-mono font-semibold">+{commit.stats.additions.toLocaleString()}</span>
              <span className="text-red-400 font-mono font-semibold">−{commit.stats.deletions.toLocaleString()}</span>
              <span className="text-muted-foreground text-xs">{commit.stats.total.toLocaleString()} files</span>
            </div>
            {commit.stats.total > 0 && (
              <div className="h-1 rounded-full overflow-hidden bg-muted flex mt-0.5">
                <div className="h-full bg-green-400 rounded-full"
                  style={{ width: `${(commit.stats.additions / (commit.stats.additions + commit.stats.deletions + 0.001)) * 100}%` }} />
                <div className="h-full bg-red-400 rounded-full flex-1" />
              </div>
            )}
          </div>
        )}

        {/* Parents */}
        {parentNodes.length > 0 && (
          <div className="px-4 py-3 flex flex-col gap-2">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {parentNodes.length === 1 ? 'Parent commit' : `Parent commits (${parentNodes.length})`}
            </span>
            {parentNodes.map(pn => (
              <button key={pn.commit.sha}
                className="flex items-start gap-2 text-left rounded-lg px-2 py-1.5
                           hover:bg-accent transition-colors group w-full"
                onClick={() => selectParent(pn.commit.sha)}
              >
                <svg className="flex-shrink-0 mt-0.5 opacity-50" width="10" height="10"
                  viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ color: pn.color }}>
                  <line x1="8" y1="14" x2="8" y2="2"/><line x1="4" y1="6" x2="8" y2="2"/><line x1="12" y1="6" x2="8" y2="2"/>
                </svg>
                <div className="flex flex-col min-w-0 flex-1">
                  <code className="text-xs font-mono" style={{ color: pn.color }}>{pn.commit.shortSha}</code>
                  <span className="text-xs text-muted-foreground truncate group-hover:text-foreground transition-colors">
                    {pn.commit.subject.slice(0, 52)}{pn.commit.subject.length > 52 ? '…' : ''}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-3 flex items-center gap-3">
          <a href={ghUrl} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
            </svg>
            View on GitHub
            <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="opacity-50 group-hover:opacity-100 transition-opacity">
              <path d="M2 10L10 2M10 2H5M10 2v5"/>
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Inline panel body (compact, structured card) ─────────────────────────────

function InlineBody() {
  const { state, dispatch } = useAppContext();
  const { selectedNode, graphData, repoInfo } = state;
  const [bodyExpanded, setBodyExpanded] = useState(false);

  if (!selectedNode) return null;
  const { commit, color } = selectedNode;
  const parentNodes = commit.parents
    .map(sha => graphData?.commitMap.get(sha))
    .filter((n): n is NonNullable<typeof n> => !!n);
  const ghUrl = repoInfo ? `${repoInfo.url}/commit/${commit.sha}` : `https://github.com/commit/${commit.sha}`;
  const isBodyLong = (commit.body?.length ?? 0) > 120;

  function selectParent(sha: string) {
    if (!graphData) return;
    const node = graphData.commitMap.get(sha);
    if (node) { dispatch({ type: 'SELECT_NODE', node }); dispatch({ type: 'SCROLL_TO_SHA', sha }); }
  }

  return (
    <div className="px-3 pb-3 pt-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-x-6 gap-y-2">
      {/* Left column: message body + author */}
      <div className="flex flex-col gap-2 min-w-0">
        {/* Subject */}
        <p className="text-sm font-medium text-foreground leading-snug">{commit.subject}</p>

        {/* Body text — truncated with "show more" */}
        {commit.body && (
          <div className="flex flex-col gap-1">
            <div className={cn(
              'text-xs text-muted-foreground leading-relaxed',
              'border-l-2 pl-2.5 py-0.5',
              'whitespace-pre-wrap break-words',
            )}
              style={{ borderColor: `${color}50` }}>
              {isBodyLong && !bodyExpanded
                ? commit.body.slice(0, 200).trimEnd() + '…'
                : commit.body
              }
            </div>
            {isBodyLong && (
              <button
                onClick={() => setBodyExpanded(v => !v)}
                className="self-start text-[10px] font-medium text-muted-foreground hover:text-foreground
                           transition-colors flex items-center gap-0.5 mt-0.5"
              >
                {bodyExpanded ? (
                  <>
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M2 6.5l3-3 3 3"/>
                    </svg>
                    Show less
                  </>
                ) : (
                  <>
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M2 3.5l3 3 3-3"/>
                    </svg>
                    Show more
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Author row */}
        <div className="flex items-center gap-3 flex-wrap mt-0.5">
          <AuthorCard author={commit.author} label="" />
          {/* Stats inline */}
          {commit.stats && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="text-green-400 font-semibold">+{commit.stats.additions.toLocaleString()}</span>
                <span className="text-red-400 font-semibold">−{commit.stats.deletions.toLocaleString()}</span>
              </div>
              {commit.stats.total > 0 && (
                <div className="h-1 w-16 rounded-full overflow-hidden bg-muted flex">
                  <div className="h-full bg-green-400"
                    style={{ width: `${(commit.stats.additions / (commit.stats.additions + commit.stats.deletions + 0.001)) * 100}%` }} />
                  <div className="h-full bg-red-400 flex-1" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right column: parents + github link */}
      <div className="flex flex-col gap-2 flex-shrink-0 md:border-l md:border-border md:pl-4 md:min-w-[180px]">
        {parentNodes.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {parentNodes.length === 1 ? 'Parent' : `Parents (${parentNodes.length})`}
            </span>
            {parentNodes.map(pn => (
              <button key={pn.commit.sha}
                className="flex items-center gap-1.5 text-left rounded-md px-1.5 py-1
                           hover:bg-accent transition-colors group w-full"
                onClick={() => selectParent(pn.commit.sha)}
              >
                <svg className="flex-shrink-0 opacity-50" width="9" height="9"
                  viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ color: pn.color }}>
                  <line x1="8" y1="14" x2="8" y2="2"/><line x1="4" y1="6" x2="8" y2="2"/><line x1="12" y1="6" x2="8" y2="2"/>
                </svg>
                <code className="text-xs font-mono flex-shrink-0" style={{ color: pn.color }}>{pn.commit.shortSha}</code>
                <span className="text-xs text-muted-foreground truncate group-hover:text-foreground transition-colors">
                  {pn.commit.subject.slice(0, 36)}{pn.commit.subject.length > 36 ? '…' : ''}
                </span>
              </button>
            ))}
          </div>
        )}

        <a href={ghUrl} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground
                     transition-colors group self-start mt-auto"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
          </svg>
          <span>View on GitHub</span>
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
            className="opacity-50 group-hover:opacity-100 transition-opacity">
            <path d="M2 10L10 2M10 2H5M10 2v5"/>
          </svg>
        </a>
      </div>
    </div>
  );
}

// ─── Exported component ───────────────────────────────────────────────────────

interface DetailPanelProps {
  mode?: 'floating' | 'inline';
}

export default function DetailPanel({ mode = 'floating' }: DetailPanelProps) {
  const { state } = useAppContext();
  const { selectedNode, graphData } = state;
  const [minimized, setMinimized] = useState(false);

  if (!selectedNode || !graphData) return null;

  if (mode === 'inline') {
    return (
      <div className="w-full bg-card/40 border-b border-border/70">
        <PanelHeader mode="inline" minimized={false} onMinimize={() => {}} />
        <InlineBody />
      </div>
    );
  }

  // Floating panel
  return (
    <aside className="absolute bottom-0 sm:bottom-auto sm:top-4 left-0 right-0 sm:left-auto sm:right-4
                      z-50 sm:w-80 max-h-[65vh] sm:max-h-[calc(100%-2rem)]
                      flex flex-col sm:rounded-xl rounded-t-xl border border-border bg-card/95 backdrop-blur-sm
                      shadow-2xl overflow-hidden">
      <PanelHeader mode="floating" minimized={minimized} onMinimize={() => setMinimized(v => !v)} />
      {!minimized && <FloatingBody />}
    </aside>
  );
}
