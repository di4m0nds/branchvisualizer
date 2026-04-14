import { useEffect, useCallback } from 'react';
import { Shield, GitBranch, Key, Database } from 'lucide-react';
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

const POINTS = [
  {
    icon: Shield,
    color: '#3fb950',
    title: 'No data collection.',
    desc: "We don't collect or store anything on our servers — there are no servers.",
  },
  {
    icon: GitBranch,
    color: '#60a5fa',
    title: 'GitHub API only.',
    desc: 'Requests go directly from your browser to api.github.com.',
  },
  {
    icon: Key,
    color: '#a78bfa',
    title: 'Token stays local.',
    desc: 'Any GitHub token you provide is kept in browser memory and never persisted.',
  },
  {
    icon: Database,
    color: '#fbbf24',
    title: 'Local storage only.',
    desc: 'API responses are cached temporarily in your browser (5-minute TTL).',
  },
];

export default function PolicyModal({ onAccept, onViewPolicy }: PolicyModalProps) {
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
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-4 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">

        {/* Top accent bar */}
        <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />

        <div className="px-6 py-6 flex flex-col gap-5">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <circle cx="16" cy="6"  r="4" fill="#60a5fa"/>
                <circle cx="6"  cy="22" r="4" fill="#34d399"/>
                <circle cx="26" cy="22" r="4" fill="#f472b6"/>
                <circle cx="16" cy="28" r="3" fill="#a78bfa"/>
                <line x1="16" y1="10" x2="6"  y2="18" stroke="#60a5fa" strokeWidth="1.5"/>
                <line x1="16" y1="10" x2="26" y2="18" stroke="#60a5fa" strokeWidth="1.5"/>
                <line x1="6"  y1="26" x2="16" y2="25" stroke="#34d399" strokeWidth="1.5"/>
                <line x1="26" y1="26" x2="16" y2="25" stroke="#f472b6" strokeWidth="1.5"/>
              </svg>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Welcome to</p>
              <h1 id="policy-modal-title" className="text-base font-bold text-foreground leading-tight">
                BranchVisualizer
              </h1>
            </div>
          </div>

          {/* Intro */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            BranchVisualizer runs entirely in your browser — no accounts, no servers,
            no tracking. Please take a moment to review how it handles your data.
          </p>

          {/* Key points */}
          <div className="flex flex-col gap-2.5">
            {POINTS.map(({ icon: Icon, color, title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-3 rounded-xl bg-muted/40 border border-border/50">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: `${color}18`, color }}
                >
                  <Icon size={14} />
                </div>
                <p className="text-sm text-muted-foreground leading-snug">
                  <strong className="text-foreground font-medium">{title}</strong>{' '}
                  {desc}
                </p>
              </div>
            ))}
          </div>

          {/* Policy links */}
          <p className="text-xs text-muted-foreground text-center">
            Read our full policies:{' '}
            <button className="text-primary underline underline-offset-2 hover:text-foreground transition-colors" onClick={() => onViewPolicy('privacy')}>
              Privacy
            </button>
            <span className="mx-1.5 opacity-40">·</span>
            <button className="text-primary underline underline-offset-2 hover:text-foreground transition-colors" onClick={() => onViewPolicy('terms')}>
              Terms
            </button>
            <span className="mx-1.5 opacity-40">·</span>
            <button className="text-primary underline underline-offset-2 hover:text-foreground transition-colors" onClick={() => onViewPolicy('cookies')}>
              Cookies
            </button>
          </p>

          {/* Accept */}
          <button
            onClick={handleAccept}
            className="w-full py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Accept &amp; Continue
          </button>

          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
            By continuing you confirm that you are at least 13 years old and agree to
            the Terms of Use.
          </p>
        </div>
      </div>
    </div>
  );
}
