import { useState } from 'react';
import { useAppSelector } from '@/store/store';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import {
  fetchReleases,
  fetchDeployments,
  type ReleaseInfo,
  type DeploymentInfo,
} from '@/lib/github';
import { cn, formatDateDMY } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────

function timeAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDateDMY(iso);
}

// ─── Deployment status badge ──────────────────────────────────────────────

type DeployState = 'success' | 'failure' | 'error' | 'pending' | 'in_progress' | 'queued' | 'inactive';

function DeployStatusBadge({ state }: { state: DeployState }) {
  const cfg: Record<DeployState, { bg: string; border: string; text: string; dot: string; label: string }> = {
    success:     { bg: 'bg-green-500/15',  border: 'border-green-500/30',  text: 'text-green-400',  dot: 'bg-green-400',  label: 'Active'      },
    failure:     { bg: 'bg-red-500/15',    border: 'border-red-500/30',    text: 'text-red-400',    dot: 'bg-red-400',    label: 'Failed'      },
    error:       { bg: 'bg-red-500/15',    border: 'border-red-500/30',    text: 'text-red-400',    dot: 'bg-red-400',    label: 'Error'       },
    pending:     { bg: 'bg-amber-500/15',  border: 'border-amber-500/30',  text: 'text-amber-400',  dot: 'bg-amber-400',  label: 'Pending'     },
    in_progress: { bg: 'bg-blue-500/15',   border: 'border-blue-500/30',   text: 'text-blue-400',   dot: 'bg-blue-400',   label: 'Deploying'   },
    queued:      { bg: 'bg-amber-500/15',  border: 'border-amber-500/30',  text: 'text-amber-400',  dot: 'bg-amber-400',  label: 'Queued'      },
    inactive:    { bg: 'bg-muted/40',      border: 'border-border',        text: 'text-muted-foreground', dot: 'bg-muted-foreground', label: 'Inactive' },
  };
  const c = cfg[state] ?? cfg.inactive;

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium
                      border ${c.bg} ${c.border} ${c.text} flex-shrink-0`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${state === 'in_progress' ? 'animate-pulse' : ''}`} />
      {c.label}
    </span>
  );
}

// ─── Environment badge ────────────────────────────────────────────────────

function EnvBadge({ env }: { env: string }) {
  const lower = env.toLowerCase();
  const isProd    = lower === 'production' || lower === 'prod';
  const isPreview = lower.includes('preview') || lower.includes('staging') || lower.includes('stage');

  const cls = isProd
    ? 'bg-purple-500/15 border-purple-500/30 text-purple-400'
    : isPreview
    ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
    : 'bg-muted/30 border-border text-muted-foreground';

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold
                      border ${cls} flex-shrink-0 capitalize truncate max-w-[120px]`}
      title={env}>
      {env}
    </span>
  );
}

// ─── Release row ──────────────────────────────────────────────────────────

function ReleaseRow({ release }: { release: ReleaseInfo }) {
  const date = release.publishedAt ? timeAgoShort(release.publishedAt) : '—';

  return (
    <a
      href={release.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-start gap-3 px-4 py-3 border-b border-border/50
                 hover:bg-accent/40 transition-colors cursor-pointer group"
    >
      {/* Tag icon */}
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"
        className={cn('flex-shrink-0 mt-0.5',
          release.prerelease ? 'text-amber-400' :
          release.draft ? 'text-muted-foreground' : 'text-green-400'
        )}>
        <path d="M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/>
      </svg>

      <div className="flex flex-col gap-1 flex-1 min-w-0">
        {/* Title row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors font-mono">
            {release.tagName}
          </span>
          {release.name && release.name !== release.tagName && (
            <span className="text-sm text-foreground/80 truncate">{release.name}</span>
          )}
          {release.prerelease && (
            <span className="px-1.5 py-0.5 rounded text-[10px] border border-amber-500/30
                             bg-amber-500/10 text-amber-400 font-medium">
              Pre-release
            </span>
          )}
          {release.draft && (
            <span className="px-1.5 py-0.5 rounded text-[10px] border border-border
                             bg-muted/30 text-muted-foreground font-medium">
              Draft
            </span>
          )}
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          <span>by {release.author.login}</span>
          <span>{date}</span>
          {release.assets > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span>{release.assets} asset{release.assets !== 1 ? 's' : ''}</span>
            </>
          )}
        </div>

        {/* Body preview */}
        {release.body && (
          <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed mt-0.5">
            {release.body.slice(0, 200)}
          </p>
        )}
      </div>

      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
        className="flex-shrink-0 opacity-0 group-hover:opacity-50 mt-1">
        <path d="M2 10L10 2M10 2H5M10 2v5"/>
      </svg>
    </a>
  );
}

// ─── Deployment row ───────────────────────────────────────────────────────

function DeploymentRow({ deployment }: { deployment: DeploymentInfo }) {
  const latestStatus = deployment.statuses?.[0];
  const state = latestStatus?.state ?? 'inactive';
  const envUrl = latestStatus?.environmentUrl;
  const date = timeAgoShort(deployment.updatedAt);

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-accent/30 transition-colors">
      {/* Deploy icon */}
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"
        className="flex-shrink-0 mt-0.5 text-muted-foreground/60">
        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/>
      </svg>

      <div className="flex flex-col gap-1 flex-1 min-w-0">
        {/* Top row */}
        <div className="flex items-center gap-2 flex-wrap">
          <EnvBadge env={deployment.environment} />
          <DeployStatusBadge state={state as DeployState} />
          <code className="text-[11px] font-mono text-muted-foreground/80">{deployment.sha}</code>
        </div>

        {/* Branch + meta */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="opacity-60">
              <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6h.75a.75.75 0 0 1 0 1.5H12v1.128a2.251 2.251 0 1 1-1.5 0V7.5h-1.25a.75.75 0 0 1 0-1.5H10V5.372A2.25 2.25 0 0 1 9.5 3.25Zm-5 3a2.25 2.25 0 1 1 3 2.122v3.756a2.251 2.251 0 1 1-1.5 0V8.372A2.25 2.25 0 0 1 4.5 6.25Z"/>
            </svg>
            {deployment.ref}
          </span>
          {deployment.creator && <span>by {deployment.creator.login}</span>}
          <span>{date}</span>
          {deployment.description && (
            <>
              <span className="opacity-40">·</span>
              <span className="truncate max-w-[200px]">{deployment.description}</span>
            </>
          )}
        </div>
      </div>

      {/* Link to environment */}
      {envUrl && (
        <a
          href={envUrl}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-border
                     text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent
                     transition-colors"
          title="Open deployed environment"
        >
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 10L10 2M10 2H5M10 2v5"/>
          </svg>
          Visit
        </a>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

type ActiveTab = 'releases' | 'deployments';
type EnvFilter = 'all' | 'production' | 'preview' | 'other';

export default function ReleasesDeploymentsTab() {
  const repoInfo = useAppSelector((s) => s.repoInfo);
  const token = useAppSelector((s) => s.token);

  const [tab, setTab] = useState<ActiveTab>('releases');
  const [envFilter, setEnvFilter] = useState<EnvFilter>('all');

  const { data, loading, error } = useAsyncResource(
    async () => {
      const [{ releases }, { deployments }] = await Promise.all([
        fetchReleases(repoInfo!.owner, repoInfo!.repo),
        fetchDeployments(repoInfo!.owner, repoInfo!.repo),
      ]);
      return { releases, deployments };
    },
    [repoInfo?.owner, repoInfo?.repo],
    { enabled: !!repoInfo, scope: 'releases' },
  );
  const releases: ReleaseInfo[] = data?.releases ?? [];
  const deployments: DeploymentInfo[] = data?.deployments ?? [];

  if (!repoInfo) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground">
        <span className="text-3xl opacity-20">🚀</span>
        <span className="text-sm">No repository loaded</span>
      </div>
    );
  }

  // Environment filter
  const filteredDeployments = deployments.filter(d => {
    if (envFilter === 'all') return true;
    const lower = d.environment.toLowerCase();
    if (envFilter === 'production') return lower === 'production' || lower === 'prod';
    if (envFilter === 'preview') return lower.includes('preview') || lower.includes('staging') || lower.includes('stage');
    return !(lower === 'production' || lower === 'prod' || lower.includes('preview') || lower.includes('staging') || lower.includes('stage'));
  });

  // Counts
  const stableReleases  = releases.filter(r => !r.prerelease && !r.draft).length;
  const preReleases     = releases.filter(r => r.prerelease).length;
  const prodDeploys     = deployments.filter(d => {
    const l = d.environment.toLowerCase();
    return l === 'production' || l === 'prod';
  }).length;
  const previewDeploys  = deployments.filter(d => {
    const l = d.environment.toLowerCase();
    return l.includes('preview') || l.includes('staging') || l.includes('stage');
  }).length;

  // Unique environments for the filter buttons
  const envSet = new Set(deployments.map(d => d.environment.toLowerCase()));
  const hasPreview = [...envSet].some(e => e.includes('preview') || e.includes('staging') || e.includes('stage'));
  const hasOther   = [...envSet].some(e => {
    return !(e === 'production' || e === 'prod' || e.includes('preview') || e.includes('staging') || e.includes('stage'));
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border flex-shrink-0 bg-muted/20">
        <div className="flex items-center">
          {([
            ['releases',    'Releases',    stableReleases],
            ['deployments', 'Deployments', prodDeploys + previewDeploys],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2',
                tab === id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
              {count > 0 && (
                <span className={cn(
                  'px-1.5 py-0.5 rounded-full text-[9px] font-semibold',
                  tab === id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
                )}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Env filter — only visible on deployments tab */}
        {tab === 'deployments' && deployments.length > 0 && (
          <div className="flex items-center gap-0.5 px-2">
            {([
              ['all',        'All'],
              ['production', 'Production'],
              ...(hasPreview ? [['preview', 'Preview'] as const] : []),
              ...(hasOther   ? [['other',   'Other']   as const] : []),
            ] as [EnvFilter, string][]).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setEnvFilter(val)}
                className={cn(
                  'px-2.5 py-1 rounded text-[11px] transition-colors',
                  envFilter === val
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="animate-spin opacity-60">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" opacity=".2"/>
              <path d="M8 1a7 7 0 0 1 7 7h-1.5A5.5 5.5 0 0 0 8 2.5V1z"/>
            </svg>
            Loading…
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center px-4">
            <span className="text-2xl">⚠️</span>
            <p className="text-sm text-red-400">{error}</p>
            {!token && (
              <p className="text-xs text-muted-foreground">
                A GitHub token increases rate limits and may allow access to more data.
              </p>
            )}
          </div>
        )}

        {!loading && !error && tab === 'releases' && (
          releases.length === 0 ? (
            <Empty label="No releases found" icon="🏷" />
          ) : (
            releases.map(r => <ReleaseRow key={r.id} release={r} />)
          )
        )}

        {!loading && !error && tab === 'deployments' && (
          filteredDeployments.length === 0 ? (
            <Empty
              label={deployments.length === 0 ? 'No deployments found' : 'No deployments match filter'}
              icon="🚀"
            />
          ) : (
            filteredDeployments.map(d => <DeploymentRow key={d.id} deployment={d} />)
          )
        )}
      </div>

      {/* Footer stats */}
      {!loading && !error && (
        <div className="flex-shrink-0 px-4 py-1.5 border-t border-border bg-muted/20
                        text-[10px] text-muted-foreground flex items-center gap-3">
          {tab === 'releases' ? (
            <>
              <span className="text-green-400">{stableReleases} stable</span>
              <span className="text-amber-400">{preReleases} pre-release</span>
              <span>{releases.filter(r => r.draft).length} draft</span>
            </>
          ) : (
            <>
              <span className="text-purple-400">{prodDeploys} production</span>
              <span className="text-blue-400">{previewDeploys} preview</span>
              <span>{deployments.length - prodDeploys - previewDeploys} other</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Empty({ label, icon = '🔍' }: { label: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
      <span className="text-2xl opacity-40">{icon}</span>
      <span className="text-sm">{label}</span>
    </div>
  );
}
