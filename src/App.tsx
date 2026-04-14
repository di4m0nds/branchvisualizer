import { useState, useEffect } from 'react';
import RepoInput from './components/RepoInput';
import RepoHeader from './components/RepoHeader';
import SearchFilter from './components/SearchFilter';
import GraphCanvas from './components/GraphCanvas';
import CommitListView from './components/CommitListView';
import DetailPanel from './components/DetailPanel';
import LoadingOverlay from './components/LoadingOverlay';
import ErrorBanner from './components/ErrorBanner';
import PolicyModal, { hasAcceptedPolicy } from './components/PolicyModal';
import LegalPage, { type LegalTab } from './components/LegalPage';
import AnimatedBackground from './components/AnimatedBackground';
import ThemeToggle from './components/ThemeToggle';
import ViewToggle from './components/ViewToggle';
import { useAppContext } from './store/AppContext';

export default function App() {
  const { state } = useAppContext();
  const hasGraph = !!state.graphData;

  // Apply initial theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Legal state ──────────────────────────────────────────────────────────
  const [showPolicyModal, setShowPolicyModal] = useState<boolean>(() => !hasAcceptedPolicy());
  const [legalTab, setLegalTab] = useState<LegalTab | null>(null);

  function openLegal(tab: LegalTab = 'privacy') { setLegalTab(tab); }
  function closeLegal() { setLegalTab(null); }
  function handlePolicyAccept() { setShowPolicyModal(false); }
  function handleViewPolicy(tab: LegalTab) { setLegalTab(tab); }

  const isCanvas = state.viewMode === 'canvas';

  return (
    <div className="app-shell">
      {/* ── Animated cyber background ────────────── */}
      <AnimatedBackground />

      {/* ── Top bar ──────────────────────────────── */}
      <header className="app-header">
        {/* Brand */}
        <div className="app-brand">
          <svg className="app-logo" width="22" height="22" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="6"  r="4" fill="var(--accent-cyan)"/>
            <circle cx="6"  cy="22" r="4" fill="var(--accent-teal)"/>
            <circle cx="26" cy="22" r="4" fill="var(--accent-pink)"/>
            <circle cx="16" cy="28" r="3" fill="var(--accent-purple)"/>
            <line x1="16" y1="10" x2="6"  y2="18" stroke="var(--accent-cyan)"   strokeWidth="1.5"/>
            <line x1="16" y1="10" x2="26" y2="18" stroke="var(--accent-cyan)"   strokeWidth="1.5"/>
            <line x1="6"  y1="26" x2="16" y2="25" stroke="var(--accent-teal)"   strokeWidth="1.5"/>
            <line x1="26" y1="26" x2="16" y2="25" stroke="var(--accent-pink)"   strokeWidth="1.5"/>
          </svg>
          <span className="app-title">BranchVisualizer</span>
        </div>

        {/* Repo URL input */}
        <RepoInput />

        {/* Header controls */}
        <div className="header-controls">
          {/* View toggle — only when graph is loaded */}
          {hasGraph && <ViewToggle />}

          {/* Theme toggle */}
          <ThemeToggle />

          {/* Legal */}
          <button
            className="header-legal-btn"
            onClick={() => openLegal('privacy')}
            title="Legal & Compliance"
            aria-label="Open legal information"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1L1 4v4c0 3.31 2.99 6.41 7 7 4.01-.59 7-3.69 7-7V4L8 1z"
                stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
              <path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.4"
                strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Legal
          </button>
        </div>
      </header>

      {/* ── Repo metadata bar ────────────────────── */}
      {hasGraph && <RepoHeader />}

      {/* ── Error banner ─────────────────────────── */}
      <ErrorBanner />

      {/* ── Filter bar ───────────────────────────── */}
      {hasGraph && <SearchFilter />}

      {/* ── Main workspace ───────────────────────── */}
      <main className="app-workspace">
        {/* Active view */}
        {isCanvas ? <GraphCanvas /> : <CommitListView />}

        {/* Detail side panel — shown when a commit is selected */}
        {state.selectedNode && <DetailPanel />}
      </main>

      {/* ── Loading overlay ───────────────────────── */}
      <LoadingOverlay />

      {/* ── Keyboard hints (canvas only) ─────────── */}
      {hasGraph && isCanvas && (
        <div className="keyboard-hints">
          <kbd>F</kbd> fit&nbsp;·&nbsp;<kbd>+</kbd><kbd>−</kbd> zoom&nbsp;·&nbsp;<kbd>0</kbd> reset&nbsp;·&nbsp;<kbd>Esc</kbd> deselect
        </div>
      )}

      {/* ── Footer ───────────────────────────────── */}
      <footer className="app-footer">
        <button className="app-footer-link" onClick={() => openLegal('privacy')}>Privacy Policy</button>
        <span className="app-footer-sep">·</span>
        <button className="app-footer-link" onClick={() => openLegal('terms')}>Terms of Use</button>
        <span className="app-footer-sep">·</span>
        <button className="app-footer-link" onClick={() => openLegal('cookies')}>Storage &amp; Cookies</button>
        <span className="app-footer-sep">·</span>
        <span className="app-footer-copy">© {new Date().getFullYear()} BranchVisualizer</span>
      </footer>

      {/* ── Policy modal (first visit) ───────────── */}
      {showPolicyModal && (
        <PolicyModal onAccept={handlePolicyAccept} onViewPolicy={handleViewPolicy} />
      )}

      {/* ── Legal overlay ────────────────────────── */}
      {legalTab && (
        <LegalPage initialTab={legalTab} onClose={closeLegal} />
      )}
    </div>
  );
}
