import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { Toaster } from 'sonner';

import { useAppContext } from '@/store/AppContext';
import { useRepoData } from '@/hooks/useRepoData';
import Navbar from '@/components/layout/Navbar';
import RepoSearch from '@/components/repo/RepoSearch';
import RepoHeader from '@/components/RepoHeader';
import TabWorkspace from '@/components/workspace/TabWorkspace';
import LoadingOverlay from '@/components/LoadingOverlay';
import ErrorBanner from '@/components/ErrorBanner';
import PolicyModal, { hasAcceptedPolicy } from '@/components/PolicyModal';
import LegalPage, { type LegalTab } from '@/components/LegalPage';

// ─── Home page (/) ─────────────────────────────────────────────────────────────

function HomePage() {
  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      <main className="flex flex-col items-center justify-start sm:justify-center flex-1
                       px-4 sm:px-6 py-10 sm:py-16 gap-8 sm:gap-12 min-h-fit">
        {/* Hero */}
        <div className="flex flex-col items-center gap-4 text-center max-w-2xl w-full">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border
                          bg-muted/40 text-xs text-muted-foreground font-mono mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-300 animate-pulse" />
            GitHub Commit Graph Visualizer
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            Explore any repository's
            <span className="block text-green-300">branch history</span>
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg leading-relaxed opacity-70">
            Enter any public GitHub repository to render an interactive commit graph —
            branches, merges, tags, and authors, all at a glance.
          </p>
        </div>

        {/* Search form */}
        <div className="w-full max-w-2xl">
          <RepoSearch compact={false} />
        </div>

        {/* Feature highlights */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 w-full max-w-2xl">
          {[
            { icon: '⎇', label: 'Branch graph', desc: 'Visualize every branch and merge as an interactive DAG' },
            { icon: '🏷', label: 'Tags & releases', desc: 'See semantic version tags inline on the commit timeline' },
            { icon: '🔍', label: 'Smart filters', desc: 'Filter by author, date range, branch, or commit message' },
          ].map(f => (
            <div key={f.label}
              className="flex flex-col gap-2 p-4 rounded-xl border border-border bg-card
                         hover:bg-accent/30 transition-colors">
              <span className="text-xl">{f.icon}</span>
              <span className="text-sm font-semibold text-foreground">{f.label}</span>
              <span className="text-xs text-muted-foreground leading-relaxed">{f.desc}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

// ─── Repo page (/:owner/:repo) ─────────────────────────────────────────────────

function RepoPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { state } = useAppContext();
  const { loadRepo } = useRepoData();
  const hasGraph = !!state.graphData;

  // Auto-load when navigating directly to a repo URL
  useEffect(() => {
    if (!owner || !repo) return;
    const current = state.repoInfo;
    const isLoading = !['idle', 'error', 'done'].includes(state.loadState.phase);
    if (isLoading) return;
    if (current?.owner === owner && current?.repo === repo) return;
    loadRepo(`https://github.com/${owner}/${repo}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo]);

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Compact search bar — relative + z-20 so its dropdown overlays the canvas below */}
      <div className="relative z-20 flex-shrink-0 px-4 py-2 border-b border-border bg-background/80 backdrop-blur-sm">
        <RepoSearch compact={true} />
      </div>

      {/* Repo metadata */}
      {hasGraph && <div className="flex-shrink-0"><RepoHeader /></div>}

      {/* Error */}
      <div className="flex-shrink-0"><ErrorBanner /></div>

      {/* Main workspace: tab system with graph, list, files, readme, prs */}
      <TabWorkspace />

      {/* Loading overlay */}
      <LoadingOverlay />
    </div>
  );
}

// ─── Root shell ────────────────────────────────────────────────────────────────

function AppShell() {
  const { state } = useAppContext();

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', state.theme);
    if (state.theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [state.theme]);

  const [showPolicyModal, setShowPolicyModal] = useState<boolean>(() => !hasAcceptedPolicy());
  const [legalTab, setLegalTab] = useState<LegalTab | null>(null);

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <Navbar />

      <div className="flex flex-col flex-1 min-h-0">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/:owner/:repo" element={<RepoPage />} />
        </Routes>
      </div>

      <Toaster
        position="bottom-right"
        theme={state.theme}
        richColors
        closeButton
      />

      {showPolicyModal && (
        <PolicyModal
          onAccept={() => setShowPolicyModal(false)}
          onViewPolicy={(tab) => setLegalTab(tab)}
        />
      )}
      {legalTab && (
        <LegalPage initialTab={legalTab} onClose={() => setLegalTab(null)} />
      )}

      <footer className="flex items-center justify-center gap-3 px-6 py-3 border-t border-border
                         text-xs text-muted-foreground bg-background/80 backdrop-blur-sm flex-shrink-0">
        <button className="hover:text-foreground transition-colors" onClick={() => setLegalTab('privacy')}>Privacy</button>
        <span className="opacity-30">·</span>
        <button className="hover:text-foreground transition-colors" onClick={() => setLegalTab('terms')}>Terms</button>
        <span className="opacity-30">·</span>
        <button className="hover:text-foreground transition-colors" onClick={() => setLegalTab('cookies')}>Cookies</button>
        <span className="opacity-30">·</span>
        <span>© {new Date().getFullYear()} BranchVisualizer</span>
      </footer>
    </div>
  );
}

// ─── App root ──────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
