import { useMemo, useState } from 'react';
import { GitBranch, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppDispatch, useAppSelector } from '@/store/store';
import { useRepoData } from '@/hooks/useRepoData';
import { isTauri } from '@/lib/platform';
import { checkoutBranch, fetchStatus } from '@/lib/localGit';
import { toast } from '@/services/toast';
import type { Session } from '@/types/session';

// Current-branch chip + switcher for the agent config strip. Local sessions get
// a working `git checkout` dropdown; GitHub sessions show a read-only chip since
// there's no working tree to switch. Reuses the existing `checkoutBranch`
// (git.rs) + `fetchStatus` to refresh the session's git context after a swap.

export default function BranchIndicator({ session }: { session: Session }) {
  const dispatch = useAppDispatch();
  const repoInfo = useAppSelector((s) => s.repoInfo);
  const branches = useAppSelector((s) => s.branches);
  const { loadLocalRepo } = useRepoData();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const isLocal = session.repoSource === 'local' && !!session.cwd;
  const current =
    session.context.gitBranch ?? repoInfo?.defaultBranch ?? (isLocal ? 'detached' : 'main');

  // De-duplicate branch names (local + remote can collide) for the menu.
  const branchNames = useMemo(() => {
    const names = branches.map((b) => b.name);
    return Array.from(new Set(names));
  }, [branches]);

  const canSwitch = isLocal && isTauri() && branchNames.length > 0;

  async function onSelect(name: string) {
    if (!session.cwd || name === current) { setOpen(false); return; }
    setBusy(true);
    try {
      const landed = await checkoutBranch(session.cwd, name);
      // Refresh the session's git context, then rebuild the graph for the new HEAD.
      const st = await fetchStatus(session.cwd);
      const summary = st.clean
        ? 'clean'
        : `${st.staged.length} staged · ${st.unstaged.length} unstaged · ${st.untracked.length} untracked`;
      dispatch({ type: 'SET_SESSION_GIT', sessionId: session.id, branch: landed, statusSummary: summary });
      await loadLocalRepo(session.cwd);
      toast.success(`Switched to ${landed}`);
    } catch (e) {
      toast.error('Checkout failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  const chip = (
    <span className="flex items-center gap-1.5 text-[11px] font-mono">
      <GitBranch className="w-3 h-3 text-muted-foreground" />
      <span className="truncate max-w-32">{busy ? 'switching…' : current}</span>
      {canSwitch && <ChevronDown className="w-3 h-3 opacity-60" />}
    </span>
  );

  if (!canSwitch) {
    return (
      <span
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-muted/20 text-foreground/80"
        title={isLocal ? 'Branch (switching needs the desktop app)' : 'Current branch'}
      >
        {chip}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-muted/20 hover:bg-accent/40 text-foreground transition-colors disabled:opacity-50"
        title="Switch branch"
      >
        {chip}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-56 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover shadow-xl p-1">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Switch branch
            </div>
            {branchNames.map((name) => (
              <button
                key={name}
                onClick={() => onSelect(name)}
                className={cn(
                  'flex items-center gap-2 w-full px-2 py-1.5 rounded text-[11px] font-mono text-left transition-colors',
                  name === current ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent/30',
                )}
              >
                <span className="w-3 flex-shrink-0">{name === current && <Check className="w-3 h-3" />}</span>
                <span className="truncate">{name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
