import { useMemo, useState, useEffect } from 'react';
import { useAppContext } from '../store/AppContext';

// ─── Debounce hook ────────────────────────────────────────────────────────────
// Delays propagating a value until the user stops typing for `delay` ms.
// The local state updates instantly so the input feels responsive; the
// debounced value is what gets dispatched to the store.
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function SearchFilter() {
  const { state, dispatch } = useAppContext();
  const { filter, branches, allCommits } = state;

  const hasGraph = !!state.graphData;

  // Local search string — updates instantly in the input, debounced before dispatch
  const [localSearch, setLocalSearch] = useState(filter.search);
  const debouncedSearch = useDebounced(localSearch, 200);

  // Sync debounced value into global filter
  useEffect(() => {
    if (debouncedSearch !== filter.search) {
      dispatch({ type: 'SET_FILTER', filter: { search: debouncedSearch } });
    }
  }, [debouncedSearch, filter.search, dispatch]);

  // Keep local search in sync when the filter is cleared externally (e.g. "Clear filters")
  useEffect(() => {
    if (filter.search === '' && localSearch !== '') {
      setLocalSearch('');
    }
  }, [filter.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const authors = useMemo(() => {
    const seen = new Map<string, string>(); // key → display name
    for (const c of allCommits) {
      const key = c.author.login || c.author.email;
      if (!seen.has(key)) seen.set(key, c.author.name);
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .slice(0, 80);
  }, [allCommits]);

  const setFilter = (partial: Partial<typeof filter>) => {
    dispatch({ type: 'SET_FILTER', filter: partial });
  };

  const hasActiveFilter =
    filter.search || filter.branch || filter.author || filter.dateFrom || filter.dateTo;

  return (
    <div className="search-filter-bar">
      {/* Search */}
      <div className="search-input-wrap">
        <span className="search-icon">⌕</span>
        <input
          type="text"
          className="search-input"
          placeholder="Search commits…"
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          disabled={!hasGraph}
          aria-label="Search commits by SHA, message, or author"
        />
        {localSearch && (
          <button
            className="search-clear"
            onClick={() => { setLocalSearch(''); dispatch({ type: 'SET_FILTER', filter: { search: '' } }); }}
          >✕</button>
        )}
      </div>

      {/* Branch filter */}
      <select
        className="filter-select"
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

      {/* Author filter */}
      <select
        className="filter-select"
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
      <input
        type="date"
        className="filter-date"
        value={filter.dateFrom}
        onChange={e => setFilter({ dateFrom: e.target.value })}
        disabled={!hasGraph}
        title="From date"
        aria-label="From date"
      />
      <span className="filter-date-sep">→</span>
      <input
        type="date"
        className="filter-date"
        value={filter.dateTo}
        onChange={e => setFilter({ dateTo: e.target.value })}
        disabled={!hasGraph}
        title="To date"
        aria-label="To date"
      />

      {/* Clear all */}
      {hasActiveFilter && (
        <button
          className="filter-clear-btn"
          onClick={() => {
            setLocalSearch('');
            dispatch({ type: 'SET_FILTER', filter: { search: '', branch: '', author: '', dateFrom: '', dateTo: '' } });
          }}
        >
          Clear filters
        </button>
      )}

      {/* Stats */}
      {state.graphData && (
        <span className="filter-stats">
          {state.graphData.rowCount.toLocaleString()} commit{state.graphData.rowCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
