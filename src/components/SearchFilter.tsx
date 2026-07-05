import { useMemo, useState, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '../store/store';

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function SearchFilter({ floating = false }: { floating?: boolean }) {
  const dispatch = useAppDispatch();
  const filter = useAppSelector((s) => s.filter);
  const branches = useAppSelector((s) => s.branches);
  const allCommits = useAppSelector((s) => s.allCommits);
  const graphData = useAppSelector((s) => s.graphData);

  const hasGraph = !!graphData;

  const [localSearch, setLocalSearch] = useState(filter.search);
  const debouncedSearch = useDebounced(localSearch, 200);

  useEffect(() => {
    if (debouncedSearch !== filter.search) {
      dispatch({ type: 'SET_FILTER', filter: { search: debouncedSearch } });
    }
  }, [debouncedSearch, filter.search, dispatch]);

  useEffect(() => {
    if (filter.search === '' && localSearch !== '') setLocalSearch('');
  }, [filter.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const authors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of allCommits) {
      const key = c.author.login || c.author.email;
      if (!seen.has(key)) seen.set(key, c.author.name);
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .slice(0, 80);
  }, [allCommits]);

  const setFilter = (partial: Partial<typeof filter>) =>
    dispatch({ type: 'SET_FILTER', filter: partial });

  const hasActiveFilter =
    filter.search || filter.branch || filter.author || filter.dateFrom || filter.dateTo;

  const inputBase = 'h-7 rounded-md border border-border bg-background text-sm text-foreground' +
    ' placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40' +
    ' focus:border-primary/50 disabled:opacity-50 transition-all px-2';

  return (
    <div className={`flex items-center gap-2 px-4 py-2 bg-muted/20 flex-shrink-0 flex-wrap${floating ? '' : ' border-b border-border'}`}>
      {/* Search */}
      <div className="relative flex items-center">
        <span className="absolute left-2 text-muted-foreground text-xs pointer-events-none">⌕</span>
        <input
          type="text"
          className={`${inputBase} pl-6 w-48`}
          placeholder="Search commits…"
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          disabled={!hasGraph}
          aria-label="Search commits"
        />
        {localSearch && (
          <button
            className="absolute right-1.5 text-muted-foreground hover:text-foreground text-xs transition-colors"
            onClick={() => { setLocalSearch(''); dispatch({ type: 'SET_FILTER', filter: { search: '' } }); }}
          >✕</button>
        )}
      </div>

      {/* Branch */}
      <select
        className={`${inputBase} pr-6 cursor-pointer`}
        value={filter.branch}
        onChange={e => setFilter({ branch: e.target.value })}
        disabled={!hasGraph}
        aria-label="Filter by branch"
      >
        <option value="">All branches</option>
        {branches.map(b => (
          <option key={b.name} value={b.name}>
            {b.isDefault ? `★ ${b.name}` : b.name}
          </option>
        ))}
      </select>

      {/* Author */}
      <select
        className={`${inputBase} pr-6 cursor-pointer`}
        value={filter.author}
        onChange={e => setFilter({ author: e.target.value })}
        disabled={!hasGraph}
        aria-label="Filter by author"
      >
        <option value="">All authors</option>
        {authors.map(([key, name]) => (
          <option key={key} value={key}>{name}</option>
        ))}
      </select>

      {/* Date range */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          className={`${inputBase} w-32 text-xs`}
          value={filter.dateFrom}
          onChange={e => setFilter({ dateFrom: e.target.value })}
          disabled={!hasGraph}
          aria-label="From date"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <input
          type="date"
          className={`${inputBase} w-32 text-xs`}
          value={filter.dateTo}
          onChange={e => setFilter({ dateTo: e.target.value })}
          disabled={!hasGraph}
          aria-label="To date"
        />
      </div>

      {/* Clear */}
      {hasActiveFilter && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors
                     underline underline-offset-2"
          onClick={() => {
            setLocalSearch('');
            dispatch({ type: 'SET_FILTER', filter: { search: '', branch: '', author: '', dateFrom: '', dateTo: '' } });
          }}
        >
          Clear filters
        </button>
      )}

      {/* Stats */}
      {graphData && (
        <span className="ml-auto text-xs text-muted-foreground tabular-nums hidden sm:block">
          {graphData.rowCount.toLocaleString()} commit{graphData.rowCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
