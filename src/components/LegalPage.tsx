import { useState, useEffect, useCallback } from 'react';

export type LegalTab = 'privacy' | 'terms' | 'cookies';

interface LegalPageProps {
  initialTab?: LegalTab;
  onClose: () => void;
}

const TABS: { id: LegalTab; label: string }[] = [
  { id: 'privacy', label: 'Privacy Policy' },
  { id: 'terms',   label: 'Terms of Use' },
  { id: 'cookies', label: 'Storage & Cookies' },
];

// ─── Content sections ─────────────────────────────────────────────────────

function PrivacyContent() {
  return (
    <div className="legal-content">
      <p className="legal-updated">Last updated: April 2025</p>

      <h2>Overview</h2>
      <p>
        BranchVisualizer is a purely client-side application. It runs entirely in your
        browser and has no backend server. We do not collect, store, or transmit any
        personal data to our own systems.
      </p>

      <h2>Data We Do Not Collect</h2>
      <p>We do not collect:</p>
      <ul>
        <li>Your name, email address, or any personally identifying information</li>
        <li>Usage analytics, crash reports, or telemetry of any kind</li>
        <li>IP addresses or device fingerprints</li>
        <li>Browsing history or behaviour outside of this application</li>
      </ul>

      <h2>GitHub API Requests</h2>
      <p>
        When you load a repository, BranchVisualizer makes requests directly from your
        browser to the <strong>GitHub REST API v3</strong>{' '}
        (<code>https://api.github.com</code>). These requests are governed by{' '}
        <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener noreferrer">
          GitHub's Privacy Statement
        </a>
        . We have no control over or visibility into those requests.
      </p>

      <h2>GitHub Personal Access Token</h2>
      <p>
        You may optionally provide a GitHub Personal Access Token (PAT) to increase API
        rate limits. If you do:
      </p>
      <ul>
        <li>The token is held <strong>in browser memory only</strong> for the duration of your session.</li>
        <li>It is sent exclusively to <code>https://api.github.com</code> as a Bearer token in request headers.</li>
        <li>It is never written to <code>localStorage</code>, <code>sessionStorage</code>, or any cookie.</li>
        <li>It is cleared automatically when you close or refresh the tab.</li>
      </ul>
      <p>
        We strongly recommend using a <strong>fine-grained token</strong> scoped to public
        repository read access only.
      </p>

      <h2>Local Storage</h2>
      <p>
        BranchVisualizer writes two types of data to your browser's{' '}
        <code>localStorage</code>:
      </p>
      <ul>
        <li>
          <strong>API response cache</strong> — GitHub API responses are cached with a
          time-to-live (TTL) of 5 minutes to reduce redundant network requests and respect
          GitHub's rate limits. This data is keyed by repository and endpoint URL and
          contains only public commit/branch metadata that GitHub already serves publicly.
        </li>
        <li>
          <strong>Policy acceptance flag</strong> — A single key (<code>bv:legal:accepted</code>)
          records that you have read and accepted these policies so the welcome modal is
          not shown on subsequent visits.
        </li>
      </ul>
      <p>
        You can clear all BranchVisualizer data at any time by opening your browser's
        developer tools and clearing the site's local storage, or by using your browser's
        "Clear site data" feature.
      </p>

      <h2>Third-Party Services</h2>
      <p>
        BranchVisualizer communicates only with <code>api.github.com</code>. No
        third-party analytics, advertising, or tracking services are used.
      </p>

      <h2>Changes to This Policy</h2>
      <p>
        If this policy changes materially, the "Last updated" date at the top will be
        revised. Because we have no way to contact users directly, we encourage you to
        review this page periodically.
      </p>
    </div>
  );
}

function TermsContent() {
  return (
    <div className="legal-content">
      <p className="legal-updated">Last updated: April 2025</p>

      <h2>Acceptance of Terms</h2>
      <p>
        By using BranchVisualizer you agree to these Terms of Use. If you do not agree,
        please do not use the application.
      </p>

      <h2>Description of Service</h2>
      <p>
        BranchVisualizer is an open-source, browser-based tool that renders interactive
        commit graphs for public GitHub repositories using the GitHub REST API. It is
        provided free of charge, without warranty, for personal and professional use.
      </p>

      <h2>Use of the GitHub API</h2>
      <p>
        BranchVisualizer accesses GitHub's public API on your behalf. By using this
        application you agree to comply with{' '}
        <a href="https://docs.github.com/en/site-policy/github-terms/github-terms-of-service" target="_blank" rel="noopener noreferrer">
          GitHub's Terms of Service
        </a>{' '}
        and{' '}
        <a href="https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api" target="_blank" rel="noopener noreferrer">
          GitHub's API Rate Limits
        </a>
        . Specifically:
      </p>
      <ul>
        <li>Unauthenticated requests are limited to 60 per hour per IP address by GitHub.</li>
        <li>Authenticated requests (with a PAT) are limited to 5,000 per hour per user by GitHub.</li>
        <li>You must not use BranchVisualizer to circumvent or abuse GitHub's rate limits.</li>
        <li>You must not use BranchVisualizer to access private repositories without authorisation.</li>
      </ul>

      <h2>Acceptable Use</h2>
      <p>You agree not to use BranchVisualizer to:</p>
      <ul>
        <li>Violate any applicable law or regulation</li>
        <li>Scrape or harvest data from GitHub in violation of their terms</li>
        <li>Interfere with GitHub's services or infrastructure</li>
        <li>Reproduce, distribute, or sublicense the application in violation of its open-source licence</li>
      </ul>

      <h2>Intellectual Property</h2>
      <p>
        BranchVisualizer is open-source software. The source code is available under the
        terms of its open-source licence. Repository data displayed within the application
        belongs to its respective owners and is retrieved via GitHub's public API under
        GitHub's terms.
      </p>

      <h2>Disclaimer of Warranties</h2>
      <p>
        BranchVisualizer is provided <strong>"as is"</strong> without warranty of any kind,
        express or implied. We make no representations regarding accuracy, completeness,
        reliability, or fitness for a particular purpose. Commit graphs are generated from
        data returned by the GitHub API and may not reflect the complete history of a
        repository (see API limits in github.ts).
      </p>

      <h2>Limitation of Liability</h2>
      <p>
        To the fullest extent permitted by law, the authors of BranchVisualizer shall not
        be liable for any indirect, incidental, special, or consequential damages arising
        from your use of the application.
      </p>

      <h2>Changes to Terms</h2>
      <p>
        These terms may be updated at any time. Continued use of BranchVisualizer after
        changes are posted constitutes acceptance of the new terms.
      </p>
    </div>
  );
}

function CookiesContent() {
  return (
    <div className="legal-content">
      <p className="legal-updated">Last updated: April 2025</p>

      <h2>Cookies</h2>
      <p>
        BranchVisualizer does <strong>not</strong> use browser cookies. No cookie is
        set, read, or transmitted by this application.
      </p>

      <h2>Local Storage</h2>
      <p>
        BranchVisualizer uses the browser's <code>localStorage</code> API to store
        lightweight data on your device. Local storage data never leaves your browser
        and is not accessible to any third party.
      </p>

      <h3>What is stored</h3>
      <ul>
        <li>
          <strong><code>bv:legal:accepted</code></strong> — A flag set to{' '}
          <code>"1"</code> once you accept these policies. Prevents the welcome
          modal from appearing on subsequent visits.
        </li>
        <li>
          <strong><code>api:*</code> (prefixed cache keys)</strong> — Cached
          responses from the GitHub REST API. Each entry includes the response
          payload and a timestamp. Entries expire after <strong>5 minutes</strong> and
          are discarded automatically on the next read after expiry.
        </li>
      </ul>

      <h3>What is not stored</h3>
      <ul>
        <li>Your GitHub Personal Access Token (kept in memory only)</li>
        <li>Any personally identifying information</li>
        <li>Any data from repositories you did not explicitly load</li>
      </ul>

      <h2>How to Clear Stored Data</h2>
      <p>
        You can remove all BranchVisualizer data from your browser at any time:
      </p>
      <ul>
        <li>
          <strong>Chrome / Edge:</strong> DevTools → Application → Storage →
          Local Storage → right-click the origin → Clear
        </li>
        <li>
          <strong>Firefox:</strong> DevTools → Storage → Local Storage →
          right-click the origin → Delete All
        </li>
        <li>
          <strong>Safari:</strong> Preferences → Privacy → Manage Website Data →
          search for the site → Remove
        </li>
      </ul>
      <p>
        Clearing local storage will remove the policy acceptance flag, so the
        welcome modal will appear again on your next visit.
      </p>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export default function LegalPage({ initialTab = 'privacy', onClose }: LegalPageProps) {
  const [activeTab, setActiveTab] = useState<LegalTab>(initialTab);

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); },
    [onClose],
  );
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Sync tab if parent changes initialTab after mount
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

  return (
    <div className="legal-overlay" role="dialog" aria-modal="true" aria-label="Legal information">
      <div className="legal-dialog">
        {/* Header */}
        <div className="legal-dialog-header">
          <div className="legal-dialog-title">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1L1 4v4c0 3.31 2.99 6.41 7 7 4.01-.59 7-3.69 7-7V4L8 1z" stroke="#58a6ff" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
              <path d="M5.5 8l2 2 3-3" stroke="#3fb950" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Legal &amp; Compliance
          </div>
          <button className="legal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Tabs */}
        <div className="legal-tabs" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              className={`legal-tab${activeTab === t.id ? ' legal-tab--active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="legal-dialog-body" role="tabpanel">
          {activeTab === 'privacy'  && <PrivacyContent />}
          {activeTab === 'terms'    && <TermsContent />}
          {activeTab === 'cookies'  && <CookiesContent />}
        </div>

        {/* Footer */}
        <div className="legal-dialog-footer">
          <button className="legal-done-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
