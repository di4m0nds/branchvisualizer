import { useState } from 'react';
import RepoInput from './components/RepoInput';
import RepoHeader from './components/RepoHeader';
import SearchFilter from './components/SearchFilter';
import GraphCanvas from './components/GraphCanvas';
import DetailPanel from './components/DetailPanel';
import LoadingOverlay from './components/LoadingOverlay';
import ErrorBanner from './components/ErrorBanner';
import PolicyModal, { hasAcceptedPolicy } from './components/PolicyModal';
import LegalPage, { type LegalTab } from './components/LegalPage';
import { useAppContext } from './store/AppContext';

export default function App() {
  const { state } = useAppContext();
  const hasGraph = !!state.graphData;

  // ── Legal state ────────────────────────────────────────────────────────
  const [showPolicyModal, setShowPolicyModal] = useState<boolean>(() => !hasAcceptedPolicy());
  const [legalTab, setLegalTab] = useState<LegalTab | null>(null);

  function openLegal(tab: LegalTab = 'privacy') { setLegalTab(tab); }
  function closeLegal() { setLegalTab(null); }

  function handlePolicyAccept() { setShowPolicyModal(false); }
  function handleViewPolicy(tab: LegalTab) { setLegalTab(tab); }

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
        {/* ── Legal access button ── */}
        <button
          className="header-legal-btn"
          onClick={() => openLegal('privacy')}
          title="Legal & Compliance"
          aria-label="Open legal information"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 1L1 4v4c0 3.31 2.99 6.41 7 7 4.01-.59 7-3.69 7-7V4L8 1z"
              stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
            <path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.4"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Legal</span>
        </button>
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

      {/* ── Policy footer ─────────────────────── */}
      <footer className="app-footer">
        <button className="app-footer-link" onClick={() => openLegal('privacy')}>Privacy Policy</button>
        <span className="app-footer-sep">·</span>
        <button className="app-footer-link" onClick={() => openLegal('terms')}>Terms of Use</button>
        <span className="app-footer-sep">·</span>
        <button className="app-footer-link" onClick={() => openLegal('cookies')}>Storage &amp; Cookies</button>
        <span className="app-footer-sep">·</span>
        <span className="app-footer-copy">© {new Date().getFullYear()} BranchVisualizer</span>
      </footer>

      {/* ── First-visit policy modal ──────────── */}
      {showPolicyModal && (
        <PolicyModal onAccept={handlePolicyAccept} onViewPolicy={handleViewPolicy} />
      )}

      {/* ── Legal pages overlay ───────────────── */}
      {legalTab && (
        <LegalPage initialTab={legalTab} onClose={closeLegal} />
      )}
    </div>
  );
}
