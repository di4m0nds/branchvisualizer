import { useState, type FormEvent, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppContext } from '@/store/AppContext';
import { useRepoData } from '@/hooks/useRepoData';
import { validateRepoInput, parseRepoInput, tokenSchema } from '@/services/validation';
import { toast } from '@/services/toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const EXAMPLE_REPOS = [
  { label: 'torvalds/linux',   desc: 'Linux kernel'    },
  { label: 'facebook/react',   desc: 'React UI library'},
  { label: 'microsoft/vscode', desc: 'VS Code editor'  },
  { label: 'vercel/next.js',   desc: 'Next.js framework'},
];

interface RepoSearchProps {
  /** When true, renders as a compact inline bar (in navbar / repo page) */
  compact?: boolean;
}

export default function RepoSearch({ compact = false }: RepoSearchProps) {
  const { state, dispatch } = useAppContext();
  const { loadRepo } = useRepoData();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [showToken, setShowToken] = useState(false);
  const tokenToastRef = useRef<string | number | undefined>(undefined);

  const handleTokenChange = useCallback((newToken: string) => {
    dispatch({ type: 'SET_TOKEN', token: newToken });

    // Dismiss previous toast
    if (tokenToastRef.current !== undefined) toast.dismiss(tokenToastRef.current);

    if (!newToken) return;

    const result = tokenSchema.safeParse(newToken);
    if (!result.success) {
      tokenToastRef.current = toast.warning('Token format not recognised', {
        description: 'Expected ghp_… (classic) or github_pat_… (fine-grained)',
        duration: 4000,
      }) as string | number;
    } else {
      tokenToastRef.current = toast.success('Token saved', {
        description: 'Rate limit raised to 5,000 requests/hour',
        duration: 3000,
      }) as string | number;
    }
  }, [dispatch]);

  const isLoading = ['fetching-repo', 'fetching-branches', 'fetching-commits', 'building-graph', 'validating']
    .includes(state.loadState.phase);

  // Focus on mount (hero search)
  useEffect(() => {
    if (!compact) inputRef.current?.focus();
  }, [compact]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    const validation = validateRepoInput(raw);
    if (!validation.ok) {
      setError(validation.error ?? 'Invalid repository');
      return;
    }
    setError('');
    try {
      const { owner, repo } = parseRepoInput(raw);
      navigate(`/${owner}/${repo}`);
      await loadRepo(raw);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load repository');
    }
  }

  function handleExample(label: string) {
    setValue(`https://github.com/${label}`);
    setError('');
    const { owner, repo } = parseRepoInput(label);
    navigate(`/${owner}/${repo}`);
    loadRepo(`https://github.com/${label}`).catch(e =>
      toast.error(e instanceof Error ? e.message : 'Failed to load repository'),
    );
  }

  function handleClear() {
    setValue('');
    setError('');
    dispatch({ type: 'RESET' });
    navigate('/');
    inputRef.current?.focus();
  }

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className="flex items-center gap-2 w-full max-w-lg">
        <div className={cn(
          'relative flex items-center flex-1 h-8',
          'rounded-md border bg-surface-2 transition-all duration-150',
          'focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary/50',
          error ? 'border-destructive/60' : 'border-border',
        )}>
          <GitHubIcon className="absolute left-2.5 h-3.5 w-3.5 text-muted-fg shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => { setValue(e.target.value); setError(''); }}
            disabled={isLoading}
            placeholder="owner/repository"
            spellCheck={false}
            autoComplete="off"
            className="h-full w-full bg-transparent pl-8 pr-8 text-sm text-foreground placeholder:text-muted-fg/60 focus:outline-none font-mono"
          />
          {value && !isLoading && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 text-muted-fg hover:text-foreground transition-colors"
            >
              <XIcon className="h-3 w-3" />
            </button>
          )}
        </div>
        <Button type="submit" size="sm" loading={isLoading}>
          {isLoading ? state.loadState.message : 'Go'}
        </Button>
      </form>
    );
  }

  // ── Hero search (full-size, used on the home page)
  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Token toggle */}
      <div className="flex items-center justify-end mb-3">
        <button
          type="button"
          onClick={() => setShowToken(v => !v)}
          className={cn(
            'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-all',
            state.token || showToken
              ? 'border-primary/40 text-primary bg-primary/5'
              : 'border-border text-muted-fg hover:border-border hover:text-foreground',
          )}
        >
          <KeyIcon className="h-3 w-3" />
          {state.token ? 'Token active' : 'Add token'}
        </button>
      </div>

      {/* Token input */}
      <AnimatePresence>
        {showToken && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden mb-3"
          >
            <div className="p-3 rounded-lg border border-border bg-surface-2 space-y-2">
              <p className="text-xs text-muted-fg">
                A GitHub Personal Access Token raises the API rate limit from 60 → 5,000 req/hr.
                No special scopes needed for public repos.
              </p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="password"
                    value={state.token}
                    onChange={e => handleTokenChange(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    autoComplete="off"
                    className={cn(
                      'w-full h-8 pl-3 pr-3 rounded-md border bg-surface text-sm font-mono',
                      'text-foreground placeholder:text-muted-fg/50',
                      'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
                      'border-border transition-all',
                    )}
                  />
                </div>
                {state.token && (
                  <span className="text-xs text-success flex items-center gap-1 shrink-0">
                    <CheckIcon className="h-3 w-3" />
                    Active
                    {state.rateLimit && ` · ${state.rateLimit.remaining} left`}
                  </span>
                )}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:text-primary/80 transition-colors shrink-0"
                >
                  Create token ↗
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main search form */}
      <form onSubmit={handleSubmit}>
        <div className={cn(
          'relative flex items-center h-12 rounded-xl border transition-all duration-150',
          'bg-surface-2 shadow-md',
          'focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary/50',
          error ? 'border-destructive/60' : 'border-border',
        )}>
          <GitHubIcon className="absolute left-4 h-4 w-4 text-muted-fg shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => { setValue(e.target.value); setError(''); }}
            disabled={isLoading}
            placeholder="github.com/owner/repository or owner/repo"
            spellCheck={false}
            autoComplete="off"
            className="h-full w-full bg-transparent pl-11 pr-32 text-sm text-foreground placeholder:text-muted-fg/50 focus:outline-none font-mono"
          />
          <div className="absolute right-2 flex items-center gap-1">
            {value && !isLoading && (
              <button
                type="button"
                onClick={handleClear}
                className="h-7 w-7 flex items-center justify-center rounded-md text-muted-fg hover:text-foreground hover:bg-surface transition-colors"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            )}
            <Button type="submit" size="sm" loading={isLoading} className="px-4">
              {isLoading ? 'Loading…' : 'Visualize'}
            </Button>
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-2 text-xs text-destructive flex items-center gap-1"
            >
              <AlertIcon className="h-3 w-3 shrink-0" />
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </form>

      {/* Example repos */}
      <div className="mt-4 flex flex-wrap gap-2 justify-center">
        {EXAMPLE_REPOS.map(({ label, desc }) => (
          <button
            key={label}
            type="button"
            onClick={() => handleExample(label)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border',
              'text-xs text-muted-fg hover:text-foreground',
              'bg-surface-2 hover:bg-surface border-border hover:border-border',
              'transition-all duration-150',
            )}
            disabled={isLoading}
          >
            <span className="font-mono">{label}</span>
            <span className="text-muted-fg/50 hidden sm:block">· {desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8"/>
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="8" r="3"/>
      <path d="M8.5 8h5M11.5 8v2" strokeLinecap="round"/>
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 8l3.5 3.5L13 5"/>
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9-3a1 1 0 11-2 0 1 1 0 012 0zm-.25 3.25a.75.75 0 00-1.5 0v3a.75.75 0 001.5 0v-3z"/>
    </svg>
  );
}
