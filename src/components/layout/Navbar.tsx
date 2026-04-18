import { Link, useParams, useMatch } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAppContext } from '@/store/AppContext';
import { useCapabilities } from '@/hooks/useCapabilities';
import { toast } from '@/services/toast';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip } from '@/components/ui/tooltip';
import { formatCount } from '@/lib/utils';

const USE_BACKEND = import.meta.env.VITE_USE_BACKEND === 'true';
const API_URL =
  ((import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')) ??
  'http://localhost:3001';

// ─── Theme toggle ─────────────────────────────────────────────────────────

function ThemeToggle() {
  const { state, dispatch } = useAppContext();
  const isDark = state.theme === 'dark';

  function toggle() {
    const next = isDark ? 'light' : 'dark';
    dispatch({ type: 'SET_THEME', theme: next });
    document.documentElement.setAttribute('data-theme', next);
  }

  return (
    <Tooltip content={isDark ? 'Light mode' : 'Dark mode'}>
      <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
        {isDark ? (
          <SunIcon />
        ) : (
          <MoonIcon />
        )}
      </Button>
    </Tooltip>
  );
}

// ─── Repo stats chips ─────────────────────────────────────────────────────

function RepoStats() {
  const { state } = useAppContext();
  const { graphData, allCommits, branches, tags } = state;
  const onRepoPage = useMatch('/:owner/:repo');
  // Hide stats when no repo is loaded or user is on the home page
  if (!graphData || !onRepoPage) return null;

  const stats = [
    {
      label: 'commits',
      value: formatCount(allCommits.length),
      title: `${allCommits.length.toLocaleString()} commits`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="opacity-70">
          <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/>
        </svg>
      ),
    },
    {
      label: 'branches',
      value: formatCount(branches.length),
      title: `${branches.length.toLocaleString()} branches`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="opacity-70">
          <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
        </svg>
      ),
    },
    {
      label: 'tags',
      value: formatCount(tags.length),
      title: `${tags.length.toLocaleString()} tags`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="opacity-70">
          <path d="M2.5 7.775V2.75a.25.25 0 0 1 .25-.25h5.025a.25.25 0 0 1 .177.073l6.25 6.25a.25.25 0 0 1 0 .354l-5.025 5.025a.25.25 0 0 1-.354 0l-6.25-6.25a.25.25 0 0 1-.073-.177ZM1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775ZM6 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/>
        </svg>
      ),
    },
    {
      label: 'lanes',
      value: String(graphData.laneCount),
      title: `${graphData.laneCount} lanes — width of the branch graph`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="opacity-70">
          <line x1="3" y1="2" x2="3" y2="14"/>
          <line x1="8" y1="2" x2="8" y2="14"/>
          <line x1="13" y1="2" x2="13" y2="14"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="flex items-center gap-0.5">
      {stats.map((s, i) => (
        <div key={s.label} className="flex items-center">
          <Tooltip content={s.title}>
            <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono
                            text-muted-foreground hover:text-foreground hover:bg-accent/50
                            transition-colors cursor-default tabular-nums">
              {s.icon}
              <span className="font-semibold text-foreground">{s.value}</span>
              <span className="opacity-50 hidden sm:inline">{s.label}</span>
            </div>
          </Tooltip>
          {i < stats.length - 1 && (
            <span className="text-border/40 text-[10px] select-none px-0.5 hidden md:inline">·</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Auth controls ────────────────────────────────────────────────────────
// OAuth sign-in is reserved for a future phase.
// Token-based access is managed via the token field in the search bar.
// This component shows the OAuth user avatar + sign-out when a real session
// exists, but hides entirely when unauthenticated (no broken "Sign in" link).

function AuthControls() {
  const { authenticated, login, refresh } = useCapabilities();

  // Only render when the user has a real OAuth session (future feature).
  // Hides the broken OAuth redirect in the meantime.
  if (!authenticated) return null;

  async function handleSignOut() {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      await refresh();
      toast.success('Signed out');
    } catch {
      toast.error('Sign-out failed');
    }
  }

  const initials = login ? login.slice(0, 2).toUpperCase() : '??';
  return (
    <div className="flex items-center gap-1.5">
      <Tooltip content={login ?? 'Authenticated'}>
        <div
          className="h-7 w-7 rounded-full flex items-center justify-center
                     bg-primary/15 border border-primary/30 text-primary
                     text-[10px] font-bold select-none cursor-default"
        >
          {initials}
        </div>
      </Tooltip>
      <Tooltip content="Sign out">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleSignOut}
          aria-label="Sign out"
        >
          <SignOutIcon />
        </Button>
      </Tooltip>
    </div>
  );
}

// ─── Main Navbar ──────────────────────────────────────────────────────────

export default function Navbar() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();

  return (
    <motion.header
      initial={{ y: -4, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-border bg-surface/80 backdrop-blur-sm z-40 relative"
    >
      {/* Brand */}
      <Link to="/" className="flex items-center gap-2 shrink-0 group">
        <div className="h-8 w-8 flex items-center justify-center">
          <img src="/favicon.svg" aria-label="Logo" alt="Logo" className="w-full h-full" />
        </div>
      </Link>

      {/* Breadcrumb (shown when inside a repo) */}
      {owner && repo && (
        <>
          <Separator orientation="vertical" className="h-4" />
          <nav className="flex items-center gap-1 text-sm min-w-0">
            <Link to="/" className="text-muted-fg hover:text-foreground transition-colors shrink-0">
              Repos
            </Link>
            <ChevronIcon className="w-3 h-3 text-muted-fg shrink-0" />
            <a
              href={`https://github.com/${owner}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted-fg hover:text-foreground transition-colors truncate max-w-24"
            >
              {owner}
            </a>
            <ChevronIcon className="w-3 h-3 text-muted-fg shrink-0" />
            <span className="font-semibold text-foreground truncate max-w-32">{repo}</span>
          </nav>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right-side controls */}
      <div className="flex items-center gap-2">
        <RepoStats />

        <Separator orientation="vertical" className="h-4" />

        <Tooltip content="View on GitHub">
          <Button variant="ghost" size="icon" asChild aria-label="GitHub">
            <a href="https://github.com/di4m0nds/branchvisualizer" target="_blank" rel="noreferrer">
              <GitHubIcon className="w-4 h-4" />
            </a>
          </Button>
        </Tooltip>

        {USE_BACKEND && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <AuthControls />
          </>
        )}

        <ThemeToggle />
      </div>
    </motion.header>
  );
}

// ─── SVG Icons ────────────────────────────────────────────────────────────


function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 12l4-4-4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function GitHubIconSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>
      <path d="M10 11l3-3-3-3"/>
      <line x1="13" y1="8" x2="6" y2="8"/>
    </svg>
  );
}
