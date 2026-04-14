import RepoInput from './components/RepoInput';
import RepoHeader from './components/RepoHeader';
import SearchFilter from './components/SearchFilter';
import GraphCanvas from './components/GraphCanvas';
import DetailPanel from './components/DetailPanel';
import LoadingOverlay from './components/LoadingOverlay';
import ErrorBanner from './components/ErrorBanner';
import { useAppContext } from './store/AppContext';

export default function App() {
  const { state } = useAppContext();
  const hasGraph = !!state.graphData;

  return (
    <div className="app-shell">
      {/* ── Top bar ─────────────────────────────── */}
      <header className="app-header">
        <div className="app-brand">
          <svg className="app-logo" width="22" height="22" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="6"  r="4" fill="#60a5fa"/>
            <circle cx="6"  cy="22" r="4" fill="#34d399"/>
            <circle cx="26" cy="22" r="4" fill="#f472b6"/>
            <circle cx="16" cy="28" r="3" fill="#a78bfa"/>
            <line x1="16" y1="10" x2="6"  y2="18" stroke="#60a5fa" strokeWidth="1.5"/>
            <line x1="16" y1="10" x2="26" y2="18" stroke="#60a5fa" strokeWidth="1.5"/>
            <line x1="6"  y1="26" x2="16" y2="25" stroke="#34d399" strokeWidth="1.5"/>
            <line x1="26" y1="26" x2="16" y2="25" stroke="#f472b6" strokeWidth="1.5"/>
          </svg>
          <span className="app-title">BranchVisualizer</span>
        </div>
        <RepoInput />
      </header>

      {/* ── Repo info + error ─────────────────── */}
      {hasGraph && <RepoHeader />}
      <ErrorBanner />

      {/* ── Filter bar ───────────────────────── */}
      {hasGraph && (
        <div className="filter-bar-wrapper">
          <SearchFilter />
        </div>
      )}

      {/* ── Main area ────────────────────────── */}
      <main className={`app-main${hasGraph && state.selectedNode ? ' app-main--panel-open' : ''}`}>
        <GraphCanvas />
        {hasGraph && state.selectedNode && <DetailPanel />}
      </main>

      {/* ── Loading overlay ───────────────────── */}
      <LoadingOverlay />

      {/* ── Keyboard hint ─────────────────────── */}
      {hasGraph && (
        <div className="keyboard-hints">
          <kbd>F</kbd> fit · <kbd>+</kbd><kbd>−</kbd> zoom · <kbd>0</kbd> reset · <kbd>Esc</kbd> deselect
        </div>
      )}
    </div>
  );
}
