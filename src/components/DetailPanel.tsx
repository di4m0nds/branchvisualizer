import { useAppContext } from '@/store/AppContext';
import AuthorPopup, { AuthorCard, useAnchorRect } from '@/components/AuthorPopup';
import { cn, copyToClipboard } from '@/lib/utils';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { fetchCommitDetails, setToken, type CommitDetails, type CommitFile } from '@/lib/github';
import type { CommitAuthor } from '@/types';

// ─── Author card with hover tooltip ──────────────────────────────────────────

function AuthorCardWithTooltip({ author, label }: { author: CommitAuthor; label: string }) {
  const [showPopup, setShowPopup] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const anchorRect = useAnchorRect(showPopup, anchorRef);

  return (
    <div
      ref={anchorRef}
      onMouseEnter={() => setShowPopup(true)}
      onMouseLeave={() => setShowPopup(false)}
    >
      <AuthorCard author={author} label={label} />
      {showPopup && anchorRect && <AuthorPopup author={author} anchorRect={anchorRect} />}
    </div>
  );
}

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
  onDragHandleMouseDown?: (e: React.MouseEvent) => void;
}

function PanelHeader({ mode, minimized, onMinimize, onDragHandleMouseDown }: HeaderProps) {
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
    <div
      className={cn(
        'flex items-center gap-2 flex-shrink-0 border-b border-border',
        mode === 'floating' ? 'px-4 py-3' : 'px-3 py-2',
        mode === 'floating' && 'cursor-grab active:cursor-grabbing select-none',
      )}
      onMouseDown={mode === 'floating' ? onDragHandleMouseDown : undefined}
    >
      {mode === 'floating' && (
        <div className="flex-shrink-0 flex flex-col gap-[3px] pr-1 opacity-30">
          <div className="w-3 h-px bg-current rounded-full" />
          <div className="w-3 h-px bg-current rounded-full" />
          <div className="w-3 h-px bg-current rounded-full" />
        </div>
      )}

      <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
        <button
          onClick={handleCopy}
          onMouseDown={e => e.stopPropagation()}
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

        {commit.isMerge && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium
                           bg-purple-500/10 border border-purple-500/25 text-purple-400 flex-shrink-0">
            merge
          </span>
        )}
        {prUrl && (
          <a href={prUrl} target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium flex-shrink-0
                       bg-purple-500/10 border border-purple-500/25 text-purple-400
                       hover:bg-purple-500/20 transition-colors flex items-center gap-0.5"
          >
            #{prNumber}
            <svg width="7" height="7" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 10L10 2M10 2H5M10 2v5" />
            </svg>
          </a>
        )}

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

      <div
        className="flex items-center gap-0.5 flex-shrink-0 ml-1"
        onMouseDown={e => e.stopPropagation()}
      >
        {mode === 'floating' && (
          <button
            onClick={onMinimize}
            title={minimized ? 'Expand' : 'Minimize'}
            className="w-5 h-5 rounded flex items-center justify-center
                       text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {minimized ? (
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <path d="M2 6.5l3-3 3 3" />
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <line x1="1.5" y1="5" x2="8.5" y2="5" />
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
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── File status icon ─────────────────────────────────────────────────────────

function FileStatusDot({ status }: { status: CommitFile['status'] }) {
  const cfg = {
    added: { cls: 'bg-green-400', title: 'Added' },
    removed: { cls: 'bg-red-400', title: 'Removed' },
    modified: { cls: 'bg-amber-400', title: 'Modified' },
    renamed: { cls: 'bg-blue-400', title: 'Renamed' },
    copied: { cls: 'bg-sky-400', title: 'Copied' },
    changed: { cls: 'bg-amber-400', title: 'Changed' },
    unchanged: { cls: 'bg-muted-foreground/30', title: 'Unchanged' },
  } as const;
  const { cls, title } = cfg[status] ?? cfg.modified;
  return <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls}`} title={title} />;
}

// ─── Changed files list ───────────────────────────────────────────────────────

function FilesList({ files, repoUrl, sha }: { files: CommitFile[]; repoUrl: string | null; sha: string }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? files : files.slice(0, 8);
  const hidden = files.length - 8;

  return (
    <div className="flex flex-col gap-0.5">
      {visible.map(f => {
        const displayName = f.status === 'renamed' && f.previousFilename
          ? `${f.previousFilename} → ${f.filename.split('/').pop()}`
          : f.filename;
        const fileUrl = repoUrl ? `${repoUrl}/blob/${sha}/${f.filename}` : null;

        return (
          <div key={f.filename} className="flex items-center gap-1.5 min-w-0 group">
            <FileStatusDot status={f.status} />
            {fileUrl ? (
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 min-w-0 text-[11px] font-mono text-muted-foreground
                           truncate hover:text-foreground transition-colors"
                title={f.filename}
              >
                {displayName}
              </a>
            ) : (
              <span className="flex-1 min-w-0 text-[11px] font-mono text-muted-foreground truncate" title={f.filename}>
                {displayName}
              </span>
            )}
            {(f.additions > 0 || f.deletions > 0) && (
              <span className="flex-shrink-0 text-[10px] font-mono tabular-nums flex items-center gap-0.5">
                {f.additions > 0 && <span className="text-green-400">+{f.additions}</span>}
                {f.deletions > 0 && <span className="text-red-400">-{f.deletions}</span>}
              </span>
            )}
          </div>
        );
      })}
      {!expanded && hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="self-start text-[10px] text-muted-foreground hover:text-foreground
                     transition-colors mt-0.5 flex items-center gap-0.5"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 3.5l3 3 3-3" />
          </svg>
          {hidden} more file{hidden !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}

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

// ─── Floating panel body ──────────────────────────────────────────────────────

function FloatingBody({ details, detailsLoading }: { details: CommitDetails | null; detailsLoading: boolean }) {
  const { state, dispatch } = useAppContext();
  const { selectedNode, graphData, repoInfo } = state;
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const prevShaRef = useRef<string | null>(null);

  if (!selectedNode) return null;
  const { commit, color } = selectedNode;

  if (prevShaRef.current !== commit.sha) {
    prevShaRef.current = commit.sha;
    if (bodyExpanded) setBodyExpanded(false);
  }
  const parentNodes = commit.parents
    .map(sha => graphData?.commitMap.get(sha))
    .filter((n): n is NonNullable<typeof n> => !!n);
  const ghUrl = repoInfo ? `${repoInfo.url}/commit/${commit.sha}` : `https://github.com/commit/${commit.sha}`;
  const hasBody = Boolean(commit.body?.trim());

  function selectParent(sha: string) {
    if (!graphData) return;
    const node = graphData.commitMap.get(sha);
    if (node) { dispatch({ type: 'SELECT_NODE', node }); dispatch({ type: 'SCROLL_TO_SHA', sha }); }
  }

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
          <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Changes</span>
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
              {details.files.length > 0 && (
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

// ─── Inline panel body ────────────────────────────────────────────────────────

function InlineBody({ details, detailsLoading }: { details: CommitDetails | null; detailsLoading: boolean }) {
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
            <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              Files ({details.files.length})
            </span>
            <FilesList files={details.files} repoUrl={repoInfo?.url ?? null} sha={commit.sha} />
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

// ─── Floating panel — portal-based, freely draggable ─────────────────────────

interface FloatingPanelProps {
  details: CommitDetails | null;
  detailsLoading: boolean;
}

function FloatingPanel({ details, detailsLoading }: FloatingPanelProps) {
  const { state } = useAppContext();
  const { selectedNode } = state;
  const [minimized, setMinimized] = useState(false);

  const PANEL_W = 320;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 540;

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const sw = typeof window !== 'undefined' ? window.innerWidth : 800;
    const sh = typeof window !== 'undefined' ? window.innerHeight : 600;
    if (sw < 540) {
      const estimatedH = Math.min(sh * 0.65, 480);
      return {
        x: Math.max(8, (sw - PANEL_W) / 2),
        y: Math.max(16, Math.round((sh - estimatedH) / 2)),
      };
    }
    return {
      x: Math.max(16, sw - PANEL_W - 16),
      y: 16,
    };
  });

  const isDraggingPanel = useRef(false);
  const dragOrigin = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  const prevShaSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedNode) return;
    const sha = selectedNode.commit.sha;
    if (prevShaSeen.current !== sha) {
      prevShaSeen.current = sha;
    }
  }, [selectedNode]);

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    e.preventDefault();
    isDraggingPanel.current = true;
    dragOrigin.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelX: pos.x,
      panelY: pos.y,
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingPanel.current) return;
      setPos({
        x: dragOrigin.current.panelX + (ev.clientX - dragOrigin.current.mouseX),
        y: dragOrigin.current.panelY + (ev.clientY - dragOrigin.current.mouseY),
      });
    };

    const onMouseUp = () => {
      isDraggingPanel.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [pos]);

  if (!selectedNode) return null;

  const panelWidth = isMobile ? Math.min(PANEL_W, window.innerWidth - 16) : PANEL_W;
  const panelMaxH = isMobile ? `${window.innerHeight - 48}px` : 'calc(100vh - 32px)';

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        width: panelWidth,
        maxHeight: panelMaxH,
      }}
      className="flex flex-col rounded-xl border border-border bg-card/95 backdrop-blur-sm
                 shadow-2xl overflow-hidden"
    >
      <PanelHeader
        mode="floating"
        minimized={minimized}
        onMinimize={() => setMinimized(v => !v)}
        onDragHandleMouseDown={onHeaderMouseDown}
      />
      {!minimized && <FloatingBody details={details} detailsLoading={detailsLoading} />}
    </div>
  );

  return createPortal(panel, document.body);
}

// ─── Exported component ───────────────────────────────────────────────────────

interface DetailPanelProps {
  mode?: 'floating' | 'inline';
}

export default function DetailPanel({ mode = 'floating' }: DetailPanelProps) {
  const { state } = useAppContext();
  const { selectedNode, graphData, repoInfo, token } = state;
  const [commitDetails, setCommitDetails] = useState<CommitDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const fetchedShaRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedNode || !repoInfo) {
      setCommitDetails(null);
      fetchedShaRef.current = null;
      return;
    }
    const sha = selectedNode.commit.sha;
    if (fetchedShaRef.current === sha) return;

    fetchedShaRef.current = sha;
    setCommitDetails(null);
    setDetailsLoading(true);
    setToken(token);

    fetchCommitDetails(repoInfo.owner, repoInfo.repo, sha)
      .then(d => {
        if (fetchedShaRef.current === sha) setCommitDetails(d);
      })
      .catch(() => { })
      .finally(() => {
        if (fetchedShaRef.current === sha) setDetailsLoading(false);
      });
  }, [selectedNode?.commit.sha, repoInfo, token]);

  if (!selectedNode || !graphData) return null;

  if (mode === 'inline') {
    return (
      <div className="w-full bg-card/40 border-b border-border/70">
        <PanelHeader mode="inline" minimized={false} onMinimize={() => { }} />
        <InlineBody details={commitDetails} detailsLoading={detailsLoading} />
      </div>
    );
  }

  return <FloatingPanel details={commitDetails} detailsLoading={detailsLoading} />;
}
