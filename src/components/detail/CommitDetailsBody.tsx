import { useState, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/store';
import { AuthorCard } from '@/components/AuthorPopup';
import { cn } from '@/lib/utils';
import type { CommitDetails } from '@/lib/github';
import type { GraphNode } from '@/types';
import AuthorCardWithTooltip from './AuthorCardWithTooltip';
import FilesList from './FilesList';

// ─── Details loading skeleton ─────────────────────────────────────────────────

function DetailsSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 animate-pulse">
      {[60, 80, 45, 70].map((w, i) => (
        <div key={i} className="h-2.5 rounded bg-muted/50" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

// ─── Panel body (floating + inline variants) ─────────────────────────────────
//
// Both variants render the same commit-details data. Data flow (selectors,
// expand/collapse state, parent navigation, GitHub URL) is shared; the layout
// markup differs per variant and is branched at the bottom.

interface CommitDetailsBodyProps {
  node: GraphNode;
  details: CommitDetails | null;
  detailsLoading: boolean;
  variant: 'floating' | 'inline';
}

export default function CommitDetailsBody({ node, details, detailsLoading, variant }: CommitDetailsBodyProps) {
  const dispatch = useAppDispatch();
  const graphData = useAppSelector((s) => s.graphData);
  const repoInfo = useAppSelector((s) => s.repoInfo);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  const prevShaRef = useRef<string | null>(null);

  const { commit, color } = node;

  // Floating-only: reset local expand state when the displayed commit changes.
  if (variant === 'floating' && prevShaRef.current !== commit.sha) {
    prevShaRef.current = commit.sha;
    if (bodyExpanded) setBodyExpanded(false);
    if (filesCollapsed) setFilesCollapsed(false);
  }

  const parentNodes = commit.parents
    .map(sha => graphData?.commitMap.get(sha))
    .filter((n): n is NonNullable<typeof n> => !!n);
  const ghUrl = repoInfo ? `${repoInfo.url}/commit/${commit.sha}` : `https://github.com/commit/${commit.sha}`;
  const hasBody = Boolean(commit.body?.trim());
  const isBodyLong = (commit.body?.length ?? 0) > 120;

  function selectParent(sha: string) {
    if (!graphData) return;
    const n = graphData.commitMap.get(sha);
    if (n) { dispatch({ type: 'SELECT_NODE', node: n }); dispatch({ type: 'SCROLL_TO_SHA', sha }); }
  }

  // ── Floating variant ──────────────────────────────────────────────────────
  if (variant === 'floating') {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col divide-y divide-border">
          <div className="px-4 py-3 flex flex-col gap-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Commit message</span>
            <p className="text-sm font-medium text-foreground leading-snug">{commit.subject}</p>
            {hasBody && (
              <>
                <button
                  onClick={() => setBodyExpanded(v => !v)}
                  className="self-start flex items-center gap-1 text-[10px] font-medium
                text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                >
                  <svg
                    width="9" height="9" viewBox="0 0 10 10" fill="none"
                    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                    className={`transition-transform duration-150 ${bodyExpanded ? 'rotate-180' : ''}`}
                  >
                    <path d="M2 3.5l3 3 3-3" />
                  </svg>
                  {bodyExpanded ? 'Hide description' : 'Show description'}
                </button>
                {bodyExpanded && (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed
                                border-l-2 pl-2 mt-0.5"
                    style={{ borderColor: `${color}50` }}>
                    {commit.body}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="px-4 py-3">
            <AuthorCardWithTooltip author={commit.author} label="Author" />
          </div>

          <div className="px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Changes</span>
              {!detailsLoading && details && details.files.length > 0 && (
                <button
                  onClick={() => setFilesCollapsed(v => !v)}
                  className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  title={filesCollapsed ? 'Show file list' : 'Collapse file list'}
                >
                  <svg
                    width="9" height="9" viewBox="0 0 10 10" fill="none"
                    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                    className={`transition-transform duration-150 ${filesCollapsed ? '-rotate-90' : ''}`}
                  >
                    <path d="M2 3.5l3 3 3-3" />
                  </svg>
                  {filesCollapsed ? 'show files' : 'hide files'}
                </button>
              )}
            </div>
            {detailsLoading && <DetailsSkeleton />}
            {!detailsLoading && details?.stats && (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-green-400 font-mono font-semibold">+{details.stats.additions.toLocaleString()}</span>
                  <span className="text-red-400 font-mono font-semibold">−{details.stats.deletions.toLocaleString()}</span>
                  <span className="text-muted-foreground text-xs">{details.stats.total.toLocaleString()} line{details.stats.total !== 1 ? 's' : ''}</span>
                  {details.files.length > 0 && (
                    <span className="text-muted-foreground text-xs">{details.files.length} file{details.files.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
                {details.stats.total > 0 && (
                  <div className="h-1 rounded-full overflow-hidden bg-muted flex mt-0.5">
                    <div className="h-full bg-green-400 rounded-full"
                      style={{ width: `${(details.stats.additions / (details.stats.additions + details.stats.deletions + 0.001)) * 100}%` }} />
                    <div className="h-full bg-red-400 rounded-full flex-1" />
                  </div>
                )}
                {!filesCollapsed && details.files.length > 0 && (
                  <FilesList files={details.files} repoUrl={repoInfo?.url ?? null} sha={commit.sha} />
                )}
              </>
            )}
            {!detailsLoading && !details?.stats && (
              <span className="text-[11px] text-muted-foreground/50">No data available</span>
            )}
          </div>

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
                    <line x1="8" y1="14" x2="8" y2="2" /><line x1="4" y1="6" x2="8" y2="2" /><line x1="12" y1="6" x2="8" y2="2" />
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

          <div className="px-4 py-3 flex items-center gap-3">
            <a href={ghUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
              </svg>
              View on GitHub
              <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                className="opacity-50 group-hover:opacity-100 transition-opacity">
                <path d="M2 10L10 2M10 2H5M10 2v5" />
              </svg>
            </a>
          </div>
        </div>
      </div >
    );
  }

  // ── Inline variant ────────────────────────────────────────────────────────
  return (
    <div className="px-3 pb-3 pt-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-x-6 gap-y-2">
      <div className="flex flex-col gap-2 min-w-0">
        <p className="text-sm font-medium text-foreground leading-snug">{commit.subject}</p>

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
                      <path d="M2 6.5l3-3 3 3" />
                    </svg>
                    Show less
                  </>
                ) : (
                  <>
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M2 3.5l3 3 3-3" />
                    </svg>
                    Show more
                  </>
                )}
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap mt-0.5">
          <AuthorCard author={commit.author} label="" />
          {detailsLoading && (
            <div className="flex items-center gap-1.5 animate-pulse">
              <div className="h-3 w-12 rounded bg-muted/50" />
              <div className="h-3 w-12 rounded bg-muted/50" />
            </div>
          )}
          {!detailsLoading && details?.stats && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs font-mono">
                <span className="inline-flex items-center px-1 py-0.5 rounded-l text-[10px] font-semibold
                                 tabular-nums bg-green-500/10 text-green-400 border border-green-500/25">
                  +{details.stats.additions.toLocaleString()}
                </span>
                <span className="inline-flex items-center px-1 py-0.5 rounded-r text-[10px] font-semibold
                                 tabular-nums bg-red-500/10 text-red-400 border border-red-500/25 border-l-0">
                  -{details.stats.deletions.toLocaleString()}
                </span>
              </div>
              {details.files.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {details.files.length} file{details.files.length !== 1 ? 's' : ''}
                </span>
              )}
              {details.stats.total > 0 && (
                <div className="h-1 w-14 rounded-full overflow-hidden bg-muted flex flex-shrink-0">
                  <div className="h-full bg-green-400"
                    style={{ width: `${(details.stats.additions / (details.stats.additions + details.stats.deletions + 0.001)) * 100}%` }} />
                  <div className="h-full bg-red-400 flex-1" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 flex-shrink-0 md:border-l md:border-border md:pl-4 md:min-w-[180px]">
        {!detailsLoading && details && details.files.length > 0 && (
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setFilesCollapsed(v => !v)}
              className="flex items-center gap-1 text-left group w-full"
              title={filesCollapsed ? 'Show files' : 'Collapse files'}
            >
              <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">
                Files ({details.files.length})
              </span>
              <svg
                width="8" height="8" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                className={`text-muted-foreground transition-transform duration-150 ${filesCollapsed ? '-rotate-90' : ''}`}
              >
                <path d="M2 3.5l3 3 3-3" />
              </svg>
            </button>
            {!filesCollapsed && (
              <FilesList files={details.files} repoUrl={repoInfo?.url ?? null} sha={commit.sha} />
            )}
          </div>
        )}
        {detailsLoading && (
          <div className="flex flex-col gap-1 animate-pulse">
            <div className="h-2 w-16 rounded bg-muted/50" />
            {[55, 80, 65, 40].map((w, i) => (
              <div key={i} className="h-2.5 rounded bg-muted/40" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}

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
                  <line x1="8" y1="14" x2="8" y2="2" /><line x1="4" y1="6" x2="8" y2="2" /><line x1="12" y1="6" x2="8" y2="2" />
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
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
          </svg>
          <span>View on GitHub</span>
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
            className="opacity-50 group-hover:opacity-100 transition-opacity">
            <path d="M2 10L10 2M10 2H5M10 2v5" />
          </svg>
        </a>
      </div>
    </div >
  );
}
