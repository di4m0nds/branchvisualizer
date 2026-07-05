import { useAppSelector } from '../store/store';
import { useRepoData } from '../hooks/useRepoData';
import { formatCount, formatDateDMY } from '@/lib/utils';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import SearchFilter from './SearchFilter';

function timeUntil(date: Date): string {
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.ceil(mins / 60)}h`;
}

export default function RepoHeader() {
  const repoInfo = useAppSelector((s) => s.repoInfo);
  const rateLimit = useAppSelector((s) => s.rateLimit);
  const loadState = useAppSelector((s) => s.loadState);
  const filter = useAppSelector((s) => s.filter);
  const { loadRepo } = useRepoData();
  const [refreshing, setRefreshing] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  const activeFilterCount = [filter.search, filter.branch, filter.author, filter.dateFrom, filter.dateTo]
    .filter(Boolean).length;

  const handleFilterClick = useCallback(() => {
    if (!filtersOpen && filterBtnRef.current) {
      const rect = filterBtnRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setFiltersOpen(v => !v);
  }, [filtersOpen]);

  useEffect(() => {
    if (!filtersOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (
        filterBtnRef.current?.contains(e.target as Node) ||
        filterPanelRef.current?.contains(e.target as Node)
      ) return;
      setFiltersOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [filtersOpen]);

  if (!repoInfo) return null;

  const isLoading = !['idle', 'done', 'error'].includes(loadState.phase);

  async function handleRefresh() {
    if (isLoading || refreshing) return;
    setRefreshing(true);
    try {
      await loadRepo(`https://github.com/${repoInfo!.owner}/${repoInfo!.repo}`);
    } finally {
      setRefreshing(false);
    }
  }

  const rateLimitLow = rateLimit && rateLimit.remaining < 10;
  const rateLimitWarning = rateLimit && rateLimit.remaining < 30;

  return (
    <>
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/20
                    text-sm flex-shrink-0 flex-wrap">
      <a
        href={repoInfo.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="opacity-70">
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
        </svg>
        {repoInfo.fullName}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-50">
          <path d="M2 10L10 2M10 2H5M10 2v5" />
        </svg>
      </a>

      {repoInfo.description && (
        <>
          <span className="text-border/60">·</span>
          <button
            className="text-muted-foreground text-xs hidden md:block text-left transition-colors hover:text-foreground"
            style={{ maxWidth: descExpanded ? '100%' : '20rem' }}
            onClick={() => setDescExpanded(v => !v)}
            title={descExpanded ? 'Click to collapse' : 'Click to expand'}
          >
            <span className={descExpanded ? '' : 'truncate block'}>
              {repoInfo.description}
            </span>
          </button>
        </>
      )}

      {repoInfo.homepage && (
        <>
          <span className="text-border/60 hidden md:inline">·</span>
          <a
            href={repoInfo.homepage}
            target="_blank"
            rel="noreferrer"
            className="text-xs hidden md:flex items-center gap-1 text-primary/70 hover:text-primary transition-colors truncate max-w-[16rem]"
            title={repoInfo.homepage}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="flex-shrink-0 opacity-70">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 2c-2 3-2 9 0 12M8 2c2 3 2 9 0 12M2 8h12" />
            </svg>
            <span className="truncate">{repoInfo.homepage.replace(/^https?:\/\//, '')}</span>
          </a>
        </>
      )}

      <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
        {/* Stars — links to stargazers page */}
        <a
          href={`${repoInfo.url}/stargazers`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 hover:text-amber-300 transition-colors"
          title={`${repoInfo.starCount.toLocaleString()} stars — view stargazers`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-amber-400 flex-shrink-0">
            <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.872 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
          </svg>
          {formatCount(repoInfo.starCount)}
        </a>

        {/* Forks — links to forks page */}
        <a
          href={`${repoInfo.url}/forks`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          title={`${repoInfo.forkCount.toLocaleString()} forks — view forks`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="opacity-60 flex-shrink-0">
            <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
          </svg>
          {formatCount(repoInfo.forkCount)}
        </a>

        {/* Default branch */}
        <span className="flex items-center gap-1.5 hidden sm:flex" title="Default branch">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="opacity-60 flex-shrink-0">
            <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
          </svg>
          {repoInfo.defaultBranch}
        </span>

        {/* Last push */}
        {repoInfo.pushedAt && (
          <span className="hidden sm:block" title="Last push">
            pushed {formatDateDMY(repoInfo.pushedAt)}
          </span>
        )}

        {/* Rate limit indicator */}
        {rateLimit && (
          <span
            className={`flex items-center gap-1.5 font-mono text-xs px-1.5 py-0.5 rounded border
              ${rateLimitLow
                ? 'text-red-400 border-red-500/30 bg-red-500/10'
                : rateLimitWarning
                  ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                  : 'text-muted-foreground border-border/50'
              }`}
            title={`GitHub API: ${rateLimit.remaining}/${rateLimit.limit} requests remaining. Resets in ${timeUntil(rateLimit.resetAt)}`}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="opacity-70 flex-shrink-0">
              <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm1 12H7V7h2v5zm0-6H7V4h2v2z" />
            </svg>
            {rateLimit.remaining}/{rateLimit.limit}
            {rateLimitLow && <span className="hidden sm:inline"> · resets {timeUntil(rateLimit.resetAt)}</span>}
          </span>
        )}

        {/* Filters button */}
        <button
          ref={filterBtnRef}
          onClick={handleFilterClick}
          className={`relative flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors
            ${filtersOpen
              ? 'border-primary/50 text-foreground bg-accent'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          title="Toggle filters"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="2" y1="4" x2="14" y2="4" />
            <line x1="4" y1="8" x2="12" y2="8" />
            <line x1="6" y1="12" x2="10" y2="12" />
          </svg>
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground
                             text-[9px] font-bold flex items-center justify-center leading-none">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={isLoading || refreshing}
          className="flex items-center gap-1.5 px-2 py-1 rounded border border-border
                     text-muted-foreground hover:text-foreground hover:bg-accent transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed text-xs"
          title="Refresh repository data"
        >
          <svg
            width="13" height="13" viewBox="0 0 13 13" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
            className={refreshing || isLoading ? 'animate-spin' : ''}
          >
            <path d="M1 4.5A7 7 0 1 1 3 11M1 1v4h4" />
          </svg>
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>
    </div>

    {/* Floating filter panel — portaled, no layout impact */}
    {createPortal(
      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            ref={filterPanelRef}
            style={{ position: 'fixed', top: panelPos.top, right: panelPos.right, zIndex: 9000 }}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            className="rounded-xl border border-border bg-card/95 backdrop-blur-sm shadow-2xl overflow-hidden"
          >
            <SearchFilter floating />
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    )}
    </>
  );
}
