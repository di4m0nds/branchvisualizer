import {
  useState, type FormEvent, useRef, useEffect, useCallback, useMemo,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppContext } from '@/store/AppContext';
import { useRepoData } from '@/hooks/useRepoData';
import { validateRepoInput, parseRepoInput, tokenSchema } from '@/services/validation';
import { toast } from '@/services/toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getHistory, removeFromHistory, timeAgoShort, type HistoryEntry } from '@/lib/history';

// ─── Fallback examples (shown when no history) ────────────────────────────────

const FALLBACK_REPOS = [
  { label: 'torvalds/linux',   desc: 'Linux kernel'     },
  { label: 'facebook/react',   desc: 'React UI library' },
  { label: 'microsoft/vscode', desc: 'VS Code editor'   },
  { label: 'vercel/next.js',   desc: 'Next.js framework'},
];

interface RepoSearchProps {
  compact?: boolean;
}

// ─── Autocomplete dropdown ────────────────────────────────────────────────────

interface DropdownProps {
  suggestions: HistoryEntry[];
  activeIndex: number;
  onSelect: (entry: HistoryEntry) => void;
  onRemove: (label: string, e: React.MouseEvent) => void;
}

function AutocompleteDropdown({ suggestions, activeIndex, onSelect, onRemove }: DropdownProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
      animate={{ opacity: 1, y: 0, scaleY: 1 }}
      exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
      transition={{ duration: 0.13 }}
      style={{ transformOrigin: 'top' }}
      className="absolute top-full left-0 right-0 z-[9999] mt-1
                 rounded-lg border border-border bg-card shadow-lg overflow-hidden"
    >
      {suggestions.map((entry, i) => (
        <div
          key={entry.label}
          className={cn(
            'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors duration-75',
            'hover:bg-accent/40 group',
            i === activeIndex && 'bg-accent/50',
          )}
          onMouseDown={e => { e.preventDefault(); onSelect(entry); }}
        >
          <ClockIcon className="h-3 w-3 text-muted-foreground shrink-0 opacity-60" />
          <span className="flex-1 min-w-0 text-sm font-mono text-foreground truncate">
            {entry.label}
          </span>
          <span className="text-[10px] text-muted-foreground/60 shrink-0 hidden sm:block">
            {timeAgoShort(entry.visitedAt)}
          </span>
          <button
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity
                       ml-1 rounded p-0.5 hover:bg-destructive/20 hover:text-destructive"
            onMouseDown={e => { e.stopPropagation(); onRemove(entry.label, e); }}
            title="Remove from history"
          >
            <XSmallIcon className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div className="px-3 py-1 border-t border-border/50 text-[10px] text-muted-foreground/50 flex items-center gap-1">
        <span className="font-mono border border-border/60 rounded px-1 text-[9px]">Tab</span>
        <span>to complete</span>
        <span className="ml-1 font-mono border border-border/60 rounded px-1 text-[9px]">↑↓</span>
        <span>to navigate</span>
      </div>
    </motion.div>
  );
}

// ─── Recently visited card (for homepage) ─────────────────────────────────────

interface RecentCardProps {
  entry: HistoryEntry;
  onLoad: (entry: HistoryEntry) => void;
  onRemove: (label: string) => void;
  disabled: boolean;
}

function RecentCard({ entry, onLoad, onRemove, disabled }: RecentCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        'relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-grab active:cursor-grabbing',
        'bg-card hover:bg-accent/30 border-border hover:border-border',
        'transition-all duration-150 group select-none',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      draggable={!disabled}
      onDragStart={e => {
        const de = e as unknown as DragEvent;
        de.dataTransfer?.setData('text/plain', entry.fullUrl);
        de.dataTransfer?.setData('application/bv-repo', entry.fullUrl);
        if (de.dataTransfer) de.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => !disabled && onLoad(entry)}
      title={`${entry.label} — drag to input or click to load`}
    >
      {/* Drag handle visual indicator */}
      <div className="flex flex-col gap-0.5 shrink-0 opacity-30 group-hover:opacity-60 transition-opacity">
        <div className="flex gap-0.5">
          <div className="w-0.5 h-0.5 rounded-full bg-current" />
          <div className="w-0.5 h-0.5 rounded-full bg-current" />
        </div>
        <div className="flex gap-0.5">
          <div className="w-0.5 h-0.5 rounded-full bg-current" />
          <div className="w-0.5 h-0.5 rounded-full bg-current" />
        </div>
        <div className="flex gap-0.5">
          <div className="w-0.5 h-0.5 rounded-full bg-current" />
          <div className="w-0.5 h-0.5 rounded-full bg-current" />
        </div>
      </div>

      <RepoIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-xs font-mono font-medium text-foreground truncate">{entry.label}</span>
        <span className="text-[10px] text-muted-foreground/60">{timeAgoShort(entry.visitedAt)}</span>
      </div>

      {/* Remove button */}
      <button
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity
                   rounded p-0.5 hover:bg-destructive/20 hover:text-destructive shrink-0"
        onClick={e => { e.stopPropagation(); onRemove(entry.label); }}
        title="Remove"
      >
        <XSmallIcon className="h-3 w-3" />
      </button>
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RepoSearch({ compact = false }: RepoSearchProps) {
  const { state, dispatch } = useAppContext();
  const { loadRepo } = useRepoData();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [history, setHistory] = useState<HistoryEntry[]>(() => getHistory());
  const [isDragTarget, setIsDragTarget] = useState(false);
  const [rateTipOpen, setRateTipOpen] = useState(false);
  const tokenToastRef = useRef<string | number | undefined>(undefined);

  // Refresh history from storage when we get focus (other tabs may update it)
  const refreshHistory = useCallback(() => {
    setHistory(getHistory());
  }, []);

  const handleTokenChange = useCallback((newToken: string) => {
    dispatch({ type: 'SET_TOKEN', token: newToken });
    if (tokenToastRef.current !== undefined) toast.dismiss(tokenToastRef.current);
    if (!newToken) return;
    const result = tokenSchema.safeParse(newToken);
    if (!result.success) {
      tokenToastRef.current = toast.warning('Token format not recognised', {
        description: 'Expected ghp_… (classic) or github_pat_… (fine-grained)',
        duration: 4000,
      }) as string | number;
    } else {
      tokenToastRef.current = toast.success('Token saved', {
        description: 'Rate limit raised to 5,000 requests/hour',
        duration: 3000,
      }) as string | number;
    }
  }, [dispatch]);

  const isLoading = ['fetching-repo', 'fetching-branches', 'fetching-commits', 'building-graph', 'validating']
    .includes(state.loadState.phase);

  useEffect(() => {
    if (!compact) inputRef.current?.focus();
  }, [compact]);

  // Autocomplete suggestions: filter history by current input
  const suggestions = useMemo<HistoryEntry[]>(() => {
    const q = value.trim().toLowerCase().replace(/^https?:\/\/(www\.)?github\.com\//, '');
    if (!q) return history.slice(0, 8);
    return history.filter(h =>
      h.label.toLowerCase().includes(q) || h.fullUrl.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [value, history]);

  const showDropdown = isInputFocused && suggestions.length > 0;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setIsInputFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function doLoad(raw: string) {
    const trimmed = raw.trim();
    const validation = validateRepoInput(trimmed);
    if (!validation.ok) {
      setError(validation.error ?? 'Invalid repository');
      return;
    }
    setError('');
    try {
      const { owner, repo } = parseRepoInput(trimmed);
      navigate(`/${owner}/${repo}`);
      loadRepo(trimmed).catch(e =>
        toast.error(e instanceof Error ? e.message : 'Failed to load repository'),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load repository');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsInputFocused(false);
    setActiveIndex(-1);
    doLoad(value);
  }

  function handleSelectSuggestion(entry: HistoryEntry) {
    setValue(entry.fullUrl);
    setIsInputFocused(false);
    setActiveIndex(-1);
    doLoad(entry.fullUrl);
  }

  function handleRemoveSuggestion(label: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    removeFromHistory(label);
    setHistory(getHistory());
  }

  function handleClear() {
    setValue('');
    setError('');
    dispatch({ type: 'RESET' });
    navigate('/');
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = activeIndex >= 0 ? suggestions[activeIndex] : suggestions[0];
      if (target) {
        setValue(target.fullUrl);
        setIsInputFocused(false);
        setActiveIndex(-1);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(-1, i - 1));
    } else if (e.key === 'Escape') {
      setIsInputFocused(false);
      setActiveIndex(-1);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelectSuggestion(suggestions[activeIndex]);
    }
  }

  // ── Drag & drop onto input ─────────────────────────────────────────────────

  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('application/bv-repo') || e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragTarget(true);
    }
  }

  function handleDragLeave() {
    setIsDragTarget(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragTarget(false);
    const url = e.dataTransfer.getData('application/bv-repo') || e.dataTransfer.getData('text/plain');
    if (url) {
      setValue(url);
      setError('');
      inputRef.current?.focus();
    }
  }

  // ── Compact mode (repo page header) ───────────────────────────────────────

  if (compact) {
    const { rateLimit } = state;
    const rateLimitLow  = rateLimit && rateLimit.remaining < 10;
    const rateLimitWarn = rateLimit && rateLimit.remaining < 30;
    const pct = rateLimit ? Math.round((rateLimit.remaining / rateLimit.limit) * 100) : 100;
    const minsLeft = rateLimit ? Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 60_000) : 0;

    return (
      <div className="flex items-center gap-2 w-full max-w-lg">
        {/* Rate limit indicator — compact pill to the left of the input */}
        {rateLimit && (
          <div className="relative group flex-shrink-0 select-none">
            <button
              type="button"
              onClick={() => setRateTipOpen(v => !v)}
              onBlur={() => setTimeout(() => setRateTipOpen(false), 150)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-mono tabular-nums',
                'transition-colors cursor-default',
                rateLimitLow
                  ? 'border-red-500/40 bg-red-500/10 text-red-400'
                  : rateLimitWarn
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                    : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground',
              )}>
              {/* Status dot */}
              <span className={cn(
                'w-1.5 h-1.5 rounded-full flex-shrink-0',
                rateLimitLow ? 'bg-red-400 animate-pulse' :
                rateLimitWarn ? 'bg-amber-400' : 'bg-green-400',
              )} />
              <span>{rateLimit.remaining.toLocaleString()}</span>
              <span className="opacity-50 hidden sm:inline">/ {rateLimit.limit.toLocaleString()}</span>
            </button>

            {/* Hover + click tooltip — opens DOWNWARD (bar is at top of page) */}
            <div className={cn(
              'absolute top-full left-0 mt-2 w-64 z-[9999] pointer-events-none',
              'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
              rateTipOpen && 'opacity-100',
            )}>
              {/* Arrow pointing up */}
              <div className="absolute -top-1 left-4 w-2 h-2 bg-popover border-t border-l border-border rotate-45" />
              <div className="bg-popover border border-border rounded-lg p-3 shadow-xl text-xs space-y-2 mt-0.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">GitHub API quota</span>
                  <span className={cn(
                    'font-mono text-[10px] px-1.5 py-0.5 rounded border',
                    rateLimitLow ? 'text-red-400 border-red-500/30 bg-red-500/10' :
                    rateLimitWarn ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' :
                    'text-green-400 border-green-500/30 bg-green-500/10'
                  )}>{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      rateLimitLow ? 'bg-red-400' : rateLimitWarn ? 'bg-amber-400' : 'bg-green-400',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span>Remaining</span>
                    <span className="font-mono text-foreground">{rateLimit.remaining.toLocaleString()} / {rateLimit.limit.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Resets in</span>
                    <span className="font-mono text-foreground">{minsLeft}m</span>
                  </div>
                  {!state.token && (
                    <p className="text-[10px] pt-1 border-t border-border text-muted-foreground/70 leading-relaxed">
                      Add a GitHub token to raise the limit to 5,000 req/hr.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="relative flex-1" ref={dropdownRef}>
        <form onSubmit={handleSubmit} className="flex items-center gap-2 w-full">
          <div
            className={cn(
              'relative flex items-center flex-1 h-8',
              'rounded-md border bg-surface-2 transition-all duration-150',
              'focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary/50',
              error ? 'border-destructive/60' : 'border-border',
              isDragTarget && 'border-primary/60 bg-primary/5 ring-2 ring-primary/20',
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <GitHubIcon className="absolute left-2.5 h-3.5 w-3.5 text-muted-fg shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={e => { setValue(e.target.value); setError(''); setActiveIndex(-1); }}
              onFocus={() => { setIsInputFocused(true); refreshHistory(); }}
              onBlur={() => setTimeout(() => setIsInputFocused(false), 150)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder="owner/repository"
              spellCheck={false}
              autoComplete="off"
              className="h-full w-full bg-transparent pl-8 pr-8 text-sm text-foreground placeholder:text-muted-fg/60 focus:outline-none font-mono"
            />
            {value && !isLoading && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute right-2 text-muted-fg hover:text-foreground transition-colors"
              >
                <XIcon className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            size="sm"
            loading={isLoading}
            className="border-green-700/40 bg-green-700/10 text-green-700
                       hover:bg-green-700/15 hover:border-green-700/60
                       dark:border-green-300/30 dark:bg-green-300/10 dark:text-green-300
                       dark:hover:bg-green-300/20 dark:hover:border-green-300/50
                       font-mono tracking-wide transition-all"
          >
            {isLoading ? state.loadState.message : 'Go →'}
          </Button>
        </form>

        <AnimatePresence>
          {showDropdown && (
            <AutocompleteDropdown
              suggestions={suggestions}
              activeIndex={activeIndex}
              onSelect={handleSelectSuggestion}
              onRemove={(label, e) => handleRemoveSuggestion(label, e)}
            />
          )}
        </AnimatePresence>
        </div>
      </div>
    );
  }

  // ── Hero / homepage full mode ──────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Token toggle */}
      <div className="flex items-center justify-end mb-3">
        <button
          type="button"
          onClick={() => setShowToken(v => !v)}
          className={cn(
            'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-all',
            state.token || showToken
              ? 'border-primary/40 text-primary bg-primary/5'
              : 'border-border text-muted-fg hover:border-border hover:text-foreground',
          )}
        >
          <KeyIcon className="h-3 w-3" />
          {state.token ? 'Token active' : 'Add token'}
        </button>
      </div>

      {/* Token input */}
      <AnimatePresence>
        {showToken && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden mb-3"
          >
            <div className="p-3 rounded-lg border border-border bg-surface-2 space-y-2">
              <p className="text-xs text-muted-fg">
                A GitHub Personal Access Token raises the API rate limit from 60 → 5,000 req/hr.
                No special scopes needed for public repos.
              </p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="password"
                    value={state.token}
                    onChange={e => handleTokenChange(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    autoComplete="off"
                    className={cn(
                      'w-full h-8 pl-3 pr-3 rounded-md border bg-surface text-sm font-mono',
                      'text-foreground placeholder:text-muted-fg/50',
                      'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
                      'border-border transition-all',
                    )}
                  />
                </div>
                {state.token && (
                  <span className="text-xs text-success flex items-center gap-1 shrink-0">
                    <CheckIcon className="h-3 w-3" />
                    Active
                    {state.rateLimit && ` · ${state.rateLimit.remaining} left`}
                  </span>
                )}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:text-primary/80 transition-colors shrink-0"
                >
                  Create token ↗
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main search form */}
      <div className="relative" ref={dropdownRef}>
        <form onSubmit={handleSubmit}>
          <div
            className={cn(
              'relative flex items-center h-12 rounded-xl border transition-all duration-150',
              'bg-surface-2 shadow-md',
              'focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary/50',
              error ? 'border-destructive/60' : 'border-border',
              isDragTarget && 'border-primary/60 bg-primary/5 ring-2 ring-primary/30 shadow-lg',
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <GitHubIcon className="absolute left-4 h-4 w-4 text-muted-fg shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={e => { setValue(e.target.value); setError(''); setActiveIndex(-1); }}
              onFocus={() => { setIsInputFocused(true); refreshHistory(); }}
              onBlur={() => setTimeout(() => setIsInputFocused(false), 150)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder={isDragTarget ? 'Drop repository here…' : 'github.com/owner/repository or owner/repo'}
              spellCheck={false}
              autoComplete="off"
              className="h-full w-full bg-transparent pl-11 pr-32 text-sm text-foreground placeholder:text-muted-fg/50 focus:outline-none font-mono"
            />
            <div className="absolute right-2 flex items-center gap-1">
              {value && !isLoading && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="h-7 w-7 flex items-center justify-center rounded-md text-muted-fg hover:text-foreground hover:bg-surface transition-colors"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}
              <Button
                type="submit"
                size="sm"
                loading={isLoading}
                className="px-5 border-green-700/40 bg-green-700/10 text-green-700
                           hover:bg-green-700/15 hover:border-green-700/60
                           dark:border-green-300/30 dark:bg-green-300/10 dark:text-green-300
                           dark:hover:bg-green-300/20 dark:hover:border-green-300/50
                           font-mono tracking-wide transition-all"
              >
                {isLoading ? 'Loading…' : 'Visualize →'}
              </Button>
            </div>
          </div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-xs text-destructive flex items-center gap-1"
              >
                <AlertIcon className="h-3 w-3 shrink-0" />
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </form>

        {/* Autocomplete dropdown */}
        <AnimatePresence>
          {showDropdown && (
            <AutocompleteDropdown
              suggestions={suggestions}
              activeIndex={activeIndex}
              onSelect={handleSelectSuggestion}
              onRemove={(label, e) => handleRemoveSuggestion(label, e)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Recently visited / fallback examples */}
      <div className="mt-5">
        {history.length > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <ClockIcon className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Recently visited
              </span>
              <span className="text-[10px] text-muted-foreground/40 ml-auto">
                drag to input
              </span>
            </div>
            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 gap-2"
              layout
            >
              <AnimatePresence mode="popLayout">
                {history.slice(0, 6).map(entry => (
                  <RecentCard
                    key={entry.label}
                    entry={entry}
                    onLoad={handleSelectSuggestion}
                    onRemove={label => { removeFromHistory(label); setHistory(getHistory()); }}
                    disabled={isLoading}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Try these
              </span>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {FALLBACK_REPOS.map(({ label, desc }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setValue(`https://github.com/${label}`);
                    setError('');
                    doLoad(`https://github.com/${label}`);
                  }}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border',
                    'text-xs text-muted-fg hover:text-foreground',
                    'bg-surface-2 hover:bg-surface border-border',
                    'transition-all duration-150',
                  )}
                  disabled={isLoading}
                >
                  <span className="font-mono">{label}</span>
                  <span className="text-muted-fg/50 hidden sm:block">· {desc}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8"/>
    </svg>
  );
}

function XSmallIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 3l6 6M9 3l-6 6"/>
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="8" r="3"/>
      <path d="M8.5 8h5M11.5 8v2" strokeLinecap="round"/>
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 8l3.5 3.5L13 5"/>
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9-3a1 1 0 11-2 0 1 1 0 012 0zm-.25 3.25a.75.75 0 00-1.5 0v3a.75.75 0 001.5 0v-3z"/>
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="6"/>
      <path d="M8 5v3.5l2 1.5"/>
    </svg>
  );
}

function RepoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z"/>
    </svg>
  );
}
