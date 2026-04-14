import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAppContext } from '@/store/AppContext';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip } from '@/components/ui/tooltip';

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

// ─── View mode toggle ─────────────────────────────────────────────────────

function ViewToggle() {
  const { state, dispatch } = useAppContext();
  if (!state.graphData) return null;

  const isCanvas = state.viewMode === 'canvas';

  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-surface-2 rounded-md border border-border">
      <Tooltip content="Graph view">
        <button
          onClick={() => dispatch({ type: 'SET_VIEW_MODE', viewMode: 'canvas' })}
          className={`h-7 w-7 flex items-center justify-center rounded transition-colors text-xs
            ${isCanvas
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-fg hover:text-foreground'
            }`}
          aria-label="Graph view"
        >
          <GraphIcon />
        </button>
      </Tooltip>
      <Tooltip content="List view">
        <button
          onClick={() => dispatch({ type: 'SET_VIEW_MODE', viewMode: 'list' })}
          className={`h-7 w-7 flex items-center justify-center rounded transition-colors text-xs
            ${!isCanvas
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-fg hover:text-foreground'
            }`}
          aria-label="List view"
        >
          <ListIcon />
        </button>
      </Tooltip>
    </div>
  );
}

// ─── Main Navbar ──────────────────────────────────────────────────────────

export default function Navbar() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { state } = useAppContext();

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
        {state.graphData && <ViewToggle />}

        <Separator orientation="vertical" className="h-4" />

        <Tooltip content="GitHub">
          <Button variant="ghost" size="icon" asChild aria-label="GitHub">
            <a href="https://github.com" target="_blank" rel="noreferrer">
              <GitHubIcon className="w-4 h-4" />
            </a>
          </Button>
        </Tooltip>

        <ThemeToggle />
      </div>
    </motion.header>
  );
}

// ─── SVG Icons ────────────────────────────────────────────────────────────

function BranchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 12l4-4-4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="3" cy="3" r="1.5" />
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="3" cy="13" r="1.5" />
      <circle cx="9" cy="5" r="1.5" />
      <circle cx="9" cy="11" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
      <path stroke="currentColor" strokeWidth="1" d="M4.5 3.3 7.5 4.7M4.5 7.6 7.5 5.4M4.5 12.5 7.5 11.5M10.5 5.4 12 7M10.5 10.5 12 8.5" fill="none" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <rect x="5" y="3.5" width="9" height="1.5" rx="0.75" />
      <rect x="5" y="7.25" width="9" height="1.5" rx="0.75" />
      <rect x="5" y="11" width="9" height="1.5" rx="0.75" />
      <circle cx="2.5" cy="4.25" r="1.25" />
      <circle cx="2.5" cy="8" r="1.25" />
      <circle cx="2.5" cy="11.75" r="1.25" />
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
