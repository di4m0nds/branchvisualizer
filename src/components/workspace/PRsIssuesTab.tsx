import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '@/store/AppContext';
import { fetchPRs, fetchIssues, setToken, type PRInfo, type IssueInfo } from '@/lib/github';
import { cn, formatDateDMY } from '@/lib/utils';

// ─── State badge ─────────────────────────────────────────────────────────

function StateBadge({ state }: { state: 'open' | 'closed' | 'merged' }) {
  const cfg = {
    open:   { bg: 'bg-green-500/15',  border: 'border-green-500/30',  text: 'text-green-400',  label: 'Open'   },
    closed: { bg: 'bg-red-500/15',    border: 'border-red-500/30',    text: 'text-red-400',    label: 'Closed' },
    merged: { bg: 'bg-purple-500/15', border: 'border-purple-500/30', text: 'text-purple-400', label: 'Merged' },
  }[state];

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium
                      border ${cfg.bg} ${cfg.border} ${cfg.text} flex-shrink-0`}>
      {cfg.label}
    </span>
  );
}

// ─── Label chip ───────────────────────────────────────────────────────────

function LabelChip({ name }: { name: string }) {
  return (
    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium
                     bg-accent border border-border/60 text-muted-foreground">
      {name}
    </span>
  );
}

// ─── PR row ───────────────────────────────────────────────────────────────

function PRRow({ pr }: { pr: PRInfo }) {
  const date = formatDateDMY(pr.updatedAt);

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-start gap-3 px-4 py-3 border-b border-border/50
                 hover:bg-accent/40 transition-colors cursor-pointer group"
    >
      {/* PR icon */}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"
        className={cn('flex-shrink-0 mt-0.5',
          pr.state === 'merged' ? 'text-purple-400' :
          pr.state === 'open'   ? 'text-green-400' : 'text-red-400'
        )}>
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
      </svg>

      <div className="flex flex-col gap-1 flex-1 min-w-0">
        {/* Title row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground group-hover:text-primary transition-colors truncate">
            {pr.title}
          </span>
          <StateBadge state={pr.state} />
          {pr.draft && (
            <span className="px-1.5 py-0.5 rounded text-[10px] border border-border text-muted-foreground">
              Draft
            </span>
          )}
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          <span>#{pr.number}</span>
          <span>by {pr.user.login}</span>
          <span>{pr.base} ← {pr.head}</span>
          <span>updated {date}</span>

          {/* Stats */}
          {(pr.additions != null || pr.changedFiles != null) && (
            <>
              <span className="opacity-40">·</span>
              {pr.additions != null && (
                <span className="text-green-500 font-mono">+{pr.additions.toLocaleString()}</span>
              )}
              {pr.deletions != null && (
                <span className="text-red-400 font-mono">-{pr.deletions.toLocaleString()}</span>
              )}
              {pr.changedFiles != null && (
                <span>{pr.changedFiles.toLocaleString()} files</span>
              )}
            </>
          )}
        </div>

        {/* Labels */}
        {pr.labels.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {pr.labels.slice(0, 5).map(l => <LabelChip key={l} name={l} />)}
          </div>
        )}
      </div>

      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
        className="flex-shrink-0 opacity-0 group-hover:opacity-50 mt-1">
        <path d="M2 10L10 2M10 2H5M10 2v5"/>
      </svg>
    </a>
  );
}

// ─── Issue row ────────────────────────────────────────────────────────────

function IssueRow({ issue }: { issue: IssueInfo }) {
  const date = formatDateDMY(issue.updatedAt);

  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-start gap-3 px-4 py-3 border-b border-border/50
                 hover:bg-accent/40 transition-colors cursor-pointer group"
    >
      {/* Issue icon */}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"
        className={cn('flex-shrink-0 mt-0.5',
          issue.state === 'open' ? 'text-green-400' : 'text-red-400'
        )}>
        <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>
        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/>
      </svg>

      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground group-hover:text-primary transition-colors truncate">
            {issue.title}
          </span>
          <StateBadge state={issue.state} />
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          <span>#{issue.number}</span>
          <span>by {issue.user.login}</span>
          <span>updated {date}</span>
          {issue.comments > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span>{issue.comments} comment{issue.comments !== 1 ? 's' : ''}</span>
            </>
          )}
        </div>

        {issue.labels.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {issue.labels.slice(0, 5).map(l => <LabelChip key={l} name={l} />)}
          </div>
        )}
      </div>

      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
        className="flex-shrink-0 opacity-0 group-hover:opacity-50 mt-1">
        <path d="M2 10L10 2M10 2H5M10 2v5"/>
      </svg>
    </a>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

type ActiveTab = 'prs' | 'issues';
type StateFilter = 'all' | 'open' | 'closed' | 'merged';

export default function PRsIssuesTab() {
  const { state } = useAppContext();
  const { repoInfo, token } = state;

  const [tab, setTab] = useState<ActiveTab>('prs');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [prs, setPRs] = useState<PRInfo[]>([]);
  const [issues, setIssues] = useState<IssueInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!repoInfo) return;
    const key = `${repoInfo.owner}/${repoInfo.repo}`;
    if (loadedForRef.current === key) return;
    loadedForRef.current = key;

    setToken(token);
    setLoading(true);
    setError(null);

    Promise.all([
      fetchPRs(repoInfo.owner, repoInfo.repo),
      fetchIssues(repoInfo.owner, repoInfo.repo),
    ])
      .then(([{ prs: p }, { issues: i }]) => {
        setPRs(p);
        setIssues(i.filter(x => !x.isPR)); // exclude PR entries from issues list
      })
      .catch(e => {
        setError(e.message);
        loadedForRef.current = null;
      })
      .finally(() => setLoading(false));
  }, [repoInfo, token]);

  if (!repoInfo) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground">
        <span className="text-3xl opacity-20">🔀</span>
        <span className="text-sm">No repository loaded</span>
      </div>
    );
  }

  const filteredPRs = prs.filter(pr => {
    if (stateFilter === 'all') return true;
    return pr.state === stateFilter;
  });

  const filteredIssues = issues.filter(i => {
    if (stateFilter === 'all') return true;
    if (stateFilter === 'merged') return false; // issues don't have merged state
    return i.state === stateFilter;
  });

  const openPRs   = prs.filter(p => p.state === 'open').length;
  const mergedPRs = prs.filter(p => p.state === 'merged').length;
  const closedPRs = prs.filter(p => p.state === 'closed').length;
  const openIssues   = issues.filter(i => i.state === 'open').length;
  const closedIssues = issues.filter(i => i.state === 'closed').length;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Tab + state filter bar */}
      <div className="flex items-center gap-0 border-b border-border flex-shrink-0 bg-muted/20">
        {/* PR / Issues tabs */}
        <div className="flex items-center">
          {([['prs', 'Pull Requests', openPRs], ['issues', 'Issues', openIssues]] as const).map(([id, label, openCount]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2',
                tab === id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
              {openCount > 0 && (
                <span className={cn(
                  'px-1.5 py-0.5 rounded-full text-[9px] font-semibold',
                  tab === id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
                )}>
                  {openCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* State filter */}
        <div className="flex items-center gap-0.5 px-2">
          {(tab === 'prs'
            ? [['all', 'All'], ['open', 'Open'], ['merged', 'Merged'], ['closed', 'Closed']]
            : [['all', 'All'], ['open', 'Open'], ['closed', 'Closed']]
          ).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setStateFilter(val as StateFilter)}
              className={cn(
                'px-2.5 py-1 rounded text-[11px] transition-colors',
                stateFilter === val
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="animate-spin opacity-60">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" opacity=".2"/>
              <path d="M8 1a7 7 0 0 1 7 7h-1.5A5.5 5.5 0 0 0 8 2.5V1z"/>
            </svg>
            Loading…
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center px-4">
            <span className="text-2xl">⚠️</span>
            <p className="text-sm text-red-400">{error}</p>
            <p className="text-xs text-muted-foreground">
              {!token && 'A GitHub token increases rate limits and may allow access to more data.'}
            </p>
          </div>
        )}

        {!loading && !error && tab === 'prs' && (
          filteredPRs.length === 0 ? (
            <Empty label="No pull requests" />
          ) : (
            filteredPRs.map(pr => <PRRow key={pr.number} pr={pr} />)
          )
        )}

        {!loading && !error && tab === 'issues' && (
          filteredIssues.length === 0 ? (
            <Empty label="No issues" />
          ) : (
            filteredIssues.map(issue => <IssueRow key={issue.number} issue={issue} />)
          )
        )}
      </div>

      {/* Footer stats */}
      {!loading && !error && (
        <div className="flex-shrink-0 px-4 py-1.5 border-t border-border bg-muted/20
                        text-[10px] text-muted-foreground flex items-center gap-3">
          {tab === 'prs' ? (
            <>
              <span className="text-green-400">{openPRs} open</span>
              <span className="text-purple-400">{mergedPRs} merged</span>
              <span className="text-red-400">{closedPRs} closed</span>
            </>
          ) : (
            <>
              <span className="text-green-400">{openIssues} open</span>
              <span className="text-red-400">{closedIssues} closed</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
      <span className="text-2xl opacity-40">🔍</span>
      <span className="text-sm">{label}</span>
    </div>
  );
}
