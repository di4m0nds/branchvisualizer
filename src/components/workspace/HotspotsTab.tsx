import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '@/store/AppContext';
import { fetchCommitDetails, setToken } from '@/lib/github';
import { computeHotspots, clearHotspotsCache, type HotspotEntry } from '@/lib/hotspots';
import { cn } from '@/lib/utils';

const MAX_COMMITS = 100;
const MAX_CONCURRENT = 5;

// Simple semaphore
function makeSemaphore(max: number) {
  let inflight = 0;
  const queue: Array<() => void> = [];
  return {
    acquire(): Promise<void> {
      if (inflight < max) { inflight++; return Promise.resolve(); }
      return new Promise<void>(r => queue.push(r));
    },
    release(): void {
      const next = queue.shift();
      if (next) next(); else inflight--;
    },
  };
}

export default function HotspotsTab() {
  const { state } = useAppContext();
  const { repoInfo, allCommits, token } = state;

  const [hotspots, setHotspots] = useState<HotspotEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Track last repo to clear cache on change
  const lastRepoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!repoInfo || allCommits.length === 0) return;

    const repoKey = `${repoInfo.owner}/${repoInfo.repo}`;

    // Clear cache on new repo
    if (lastRepoRef.current !== repoKey) {
      clearHotspotsCache();
      lastRepoRef.current = repoKey;
      setHotspots([]);
      setDone(false);
    }

    if (done) return; // already computed for this repo

    let cancelled = false;
    const sem = makeSemaphore(MAX_CONCURRENT);
    setToken(token);

    const commits = allCommits.slice(0, MAX_COMMITS);
    const t = commits.length;
    setTotal(t);
    setProgress(0);
    setLoading(true);
    setError(null);

    const headSha = allCommits[0]?.sha ?? 'unknown';
    const cacheKey = `${repoKey}/${headSha}`;

    async function run() {
      let completed = 0;
      const details = await Promise.all(
        commits.map(async commit => {
          await sem.acquire();
          try {
            if (cancelled) return null;
            const d = await fetchCommitDetails(repoInfo!.owner, repoInfo!.repo, commit.sha);
            completed++;
            if (!cancelled) setProgress(completed);
            return d;
          } catch {
            completed++;
            if (!cancelled) setProgress(completed);
            return null;
          } finally {
            sem.release();
          }
        }),
      );

      if (cancelled) return;

      const validDetails = details.filter((d): d is NonNullable<typeof d> => d !== null);
      const result = computeHotspots(validDetails, cacheKey);
      setHotspots(result);
      setDone(true);
      setLoading(false);
    }

    run().catch(e => {
      if (!cancelled) {
        setError(e?.message ?? 'Failed to analyse hotspots');
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoInfo?.owner, repoInfo?.repo, token]);

  // ── No repo loaded ──────────────────────────────────────────────────────
  if (!repoInfo) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        <span className="text-sm text-muted-foreground">Load a repository to analyse hotspots</span>
      </div>
    );
  }

  // ── Loading / progress ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
          <span className="text-sm font-medium text-foreground">Hotspots</span>
          <span className="text-xs text-muted-foreground ml-auto">
            Analysing {progress}/{total} commits…
          </span>
        </div>
        {/* Progress bar */}
        <div className="mx-4 mt-3 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 rounded-full"
            style={{ width: `${total > 0 ? (progress / total) * 100 : 0}%` }}
          />
        </div>
        {/* Skeleton rows */}
        <div className="flex flex-col gap-1.5 p-4 animate-pulse">
          {[85, 70, 60, 75, 50].map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-3 rounded bg-muted/50 flex-1" style={{ maxWidth: `${w}%` }} />
              <div className="h-2 w-12 rounded bg-muted/30" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
          <span className="text-sm font-medium text-foreground">Hotspots</span>
        </div>
        <div className="p-4">
          <span className="text-xs text-red-400">{error}</span>
        </div>
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (done && hotspots.length === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
          <span className="text-sm font-medium text-foreground">Hotspots</span>
        </div>
        <div className="flex items-center justify-center flex-1 p-8 text-center">
          <span className="text-sm text-muted-foreground">No file churn data found</span>
        </div>
      </div>
    );
  }

  // ── Results ──────────────────────────────────────────────────────────────
  const defaultBranch = repoInfo.defaultBranch ?? 'main';

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
        <span className="text-sm font-medium text-foreground">Hotspots</span>
        <span className="text-xs text-muted-foreground">
          Top {hotspots.length} files · {Math.min(allCommits.length, MAX_COMMITS)} commits analysed
        </span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col divide-y divide-border/50">
          {hotspots.map((entry, idx) => {
            const fileUrl = `${repoInfo.url}/blob/${defaultBranch}/${entry.filename}`;
            const parts = entry.filename.split('/');
            const name = parts.pop() ?? entry.filename;
            const dir = parts.length > 0 ? parts.join('/') + '/' : '';

            return (
              <div key={entry.filename} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors group">
                {/* Rank */}
                <span className="text-[10px] font-mono text-muted-foreground/50 flex-shrink-0 w-4 text-right">
                  {idx + 1}
                </span>

                {/* Filename */}
                <div className="flex flex-col min-w-0 flex-1">
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono text-foreground hover:text-primary transition-colors truncate"
                    title={entry.filename}
                  >
                    {dir && <span className="text-muted-foreground">{dir}</span>}
                    <span className="font-medium">{name}</span>
                  </a>
                  {/* Heat bar */}
                  <div className="mt-1 h-1 rounded-full overflow-hidden bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        entry.score > 0.7 ? 'bg-red-400' : entry.score > 0.4 ? 'bg-amber-400' : 'bg-blue-400',
                      )}
                      style={{ width: `${entry.score * 100}%` }}
                    />
                  </div>
                </div>

                {/* Stats */}
                <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {entry.changeCount} change{entry.changeCount !== 1 ? 's' : ''}
                  </span>
                  <div className="flex items-center gap-0.5 text-[10px] font-mono tabular-nums">
                    {entry.additions > 0 && <span className="text-green-400">+{entry.additions}</span>}
                    {entry.deletions > 0 && <span className="text-red-400">-{entry.deletions}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
