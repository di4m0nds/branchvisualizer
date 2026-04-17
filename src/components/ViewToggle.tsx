import { useAppContext } from '../store/AppContext';
import type { ViewMode } from '../types';

// ─── Icons ────────────────────────────────────────────────────────────────

function ListIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <line x1="5" y1="4" x2="14" y2="4"/>
      <line x1="5" y1="8" x2="14" y2="8"/>
      <line x1="5" y1="12" x2="14" y2="12"/>
      <circle cx="2" cy="4"  r="1" fill="currentColor" stroke="none"/>
      <circle cx="2" cy="8"  r="1" fill="currentColor" stroke="none"/>
      <circle cx="2" cy="12" r="1" fill="currentColor" stroke="none"/>
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="3"  cy="3"  r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="3"  cy="8"  r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="3"  cy="13" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="8"  cy="5"  r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="8"  cy="11" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="13" cy="8"  r="1.5" fill="currentColor" stroke="none"/>
      <line x1="4.1" y1="3.5" x2="6.9" y2="4.5"/>
      <line x1="4.1" y1="8"   x2="6.5" y2="6"/>
      <line x1="4.1" y1="12.5" x2="6.9" y2="11.5"/>
      <line x1="9.1" y1="5.5" x2="11.9" y2="7.5"/>
      <line x1="9.1" y1="10.5" x2="11.9" y2="8.5"/>
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────

export default function ViewToggle() {
  const { state, dispatch } = useAppContext();
  const current = state.viewMode;

  function setView(mode: ViewMode) {
    if (mode !== current) {
      dispatch({ type: 'SET_VIEW_MODE', viewMode: mode });
    }
  }

  return (
    <div className="view-toggle" role="group" aria-label="View mode">
      <button
        className={`view-toggle-btn${current === 'canvas' ? ' view-toggle-btn--active' : ''}`}
        onClick={() => setView('canvas')}
        title="Graph view"
        aria-pressed={current === 'canvas'}
      >
        <GraphIcon />
        Graph
      </button>
      <button
        className={`view-toggle-btn${current === 'list' ? ' view-toggle-btn--active' : ''}`}
        onClick={() => setView('list')}
        title="List view"
        aria-pressed={current === 'list'}
      >
        <ListIcon />
        List
      </button>
    </div>
  );
}
