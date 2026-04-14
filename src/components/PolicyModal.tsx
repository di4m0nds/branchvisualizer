import { useEffect, useCallback } from 'react';
import type { LegalTab } from './LegalPage';

const STORAGE_KEY = 'bv:legal:accepted';

/** Returns true if the user has already accepted the policy. */
export function hasAcceptedPolicy(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; }
}

/** Persists the acceptance flag so the modal is not shown again. */
export function markPolicyAccepted(): void {
  try { localStorage.setItem(STORAGE_KEY, '1'); }
  catch { /* localStorage unavailable – continue silently */ }
}

interface PolicyModalProps {
  onAccept: () => void;
  onViewPolicy: (tab: LegalTab) => void;
}

export default function PolicyModal({ onAccept, onViewPolicy }: PolicyModalProps) {
  // Prevent background scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleAccept = useCallback(() => {
    markPolicyAccepted();
    onAccept();
  }, [onAccept]);

  return (
    <div className="policy-overlay" role="dialog" aria-modal="true" aria-labelledby="policy-modal-title">
      <div className="policy-modal">
        {/* Brand mark */}
        <div className="policy-modal-brand">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="6"  r="4" fill="#60a5fa"/>
            <circle cx="6"  cy="22" r="4" fill="#34d399"/>
            <circle cx="26" cy="22" r="4" fill="#f472b6"/>
            <circle cx="16" cy="28" r="3" fill="#a78bfa"/>
            <line x1="16" y1="10" x2="6"  y2="18" stroke="#60a5fa" strokeWidth="1.5"/>
            <line x1="16" y1="10" x2="26" y2="18" stroke="#60a5fa" strokeWidth="1.5"/>
            <line x1="6"  y1="26" x2="16" y2="25" stroke="#34d399" strokeWidth="1.5"/>
            <line x1="26" y1="26" x2="16" y2="25" stroke="#f472b6" strokeWidth="1.5"/>
          </svg>
          <span className="policy-modal-app-name">BranchVisualizer</span>
        </div>

        <h1 id="policy-modal-title" className="policy-modal-title">
          Before you continue
        </h1>

        <p className="policy-modal-intro">
          BranchVisualizer runs entirely in your browser — no accounts, no servers,
          no tracking. Please take a moment to review how it handles your data.
        </p>

        {/* Key points */}
        <ul className="policy-modal-points">
          <li>
            <span className="policy-point-icon policy-point-icon--green">✓</span>
            <span>
              <strong>No data collection.</strong> We don't collect or store anything
              on our servers — there are no servers.
            </span>
          </li>
          <li>
            <span className="policy-point-icon policy-point-icon--blue">✓</span>
            <span>
              <strong>GitHub API only.</strong> Requests go directly from your browser
              to <code>api.github.com</code>.
            </span>
          </li>
          <li>
            <span className="policy-point-icon policy-point-icon--purple">✓</span>
            <span>
              <strong>Token stays local.</strong> Any GitHub token you provide is kept
              in browser memory and never persisted.
            </span>
          </li>
          <li>
            <span className="policy-point-icon policy-point-icon--yellow">✓</span>
            <span>
              <strong>Local storage only.</strong> API responses are cached temporarily
              in your browser's local storage (5-minute TTL).
            </span>
          </li>
        </ul>

        {/* Policy links */}
        <div className="policy-modal-links">
          Read our full policies:
          <button className="policy-link-btn" onClick={() => onViewPolicy('privacy')}>
            Privacy Policy
          </button>
          <span className="policy-link-sep">·</span>
          <button className="policy-link-btn" onClick={() => onViewPolicy('terms')}>
            Terms of Use
          </button>
          <span className="policy-link-sep">·</span>
          <button className="policy-link-btn" onClick={() => onViewPolicy('cookies')}>
            Storage &amp; Cookies
          </button>
        </div>

        {/* Accept */}
        <button className="policy-accept-btn" onClick={handleAccept}>
          Accept &amp; Continue
        </button>

        <p className="policy-modal-note">
          By continuing you confirm that you are at least 13 years old and agree to
          the Terms of Use.
        </p>
      </div>
    </div>
  );
}
