import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppContext } from '@/store/AppContext';
import {
  fetchWorkflowRuns,
  fetchWorkflowJobs,
  fetchWorkflowArtifacts,
  fetchCommitCheckRuns,
  fetchCommitStatus,
  setToken,
  type WorkflowRun,
  type WorkflowJob,
  type WorkflowJobStep,
  type WorkflowArtifact,
  type CheckRun,
  type CommitCombinedStatus,
} from '@/lib/github';
import { cn, formatDateDMY } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDateDMY(iso);
}

// ─── CI state config ───────────────────────────────────────────────────────

type CIState = 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out'
             | 'action_required' | 'neutral' | 'stale' | 'in_progress' | 'queued'
             | 'pending' | 'waiting' | 'requested' | 'error';

interface StateCfg {
  bg: string; border: string; text: string; dot: string; label: string; pulse: boolean;
}

const STATE_CFG: Record<CIState, StateCfg> = {
  success:         { bg: 'bg-green-500/15',  border: 'border-green-500/30',  text: 'text-green-400',        dot: 'bg-green-400',        label: 'Passed',        pulse: false },
  failure:         { bg: 'bg-red-500/15',    border: 'border-red-500/30',    text: 'text-red-400',          dot: 'bg-red-400',          label: 'Failed',        pulse: false },
  error:           { bg: 'bg-red-500/15',    border: 'border-red-500/30',    text: 'text-red-400',          dot: 'bg-red-400',          label: 'Error',         pulse: false },
  cancelled:       { bg: 'bg-muted/40',      border: 'border-border',        text: 'text-muted-foreground', dot: 'bg-muted-foreground', label: 'Cancelled',     pulse: false },
  skipped:         { bg: 'bg-muted/40',      border: 'border-border',        text: 'text-muted-foreground', dot: 'bg-muted-foreground', label: 'Skipped',       pulse: false },
  timed_out:       { bg: 'bg-amber-500/15',  border: 'border-amber-500/30',  text: 'text-amber-400',        dot: 'bg-amber-400',        label: 'Timed out',     pulse: false },
  action_required: { bg: 'bg-amber-500/15',  border: 'border-amber-500/30',  text: 'text-amber-400',        dot: 'bg-amber-400',        label: 'Action needed', pulse: true  },
  neutral:         { bg: 'bg-muted/40',      border: 'border-border',        text: 'text-muted-foreground', dot: 'bg-muted-foreground', label: 'Neutral',       pulse: false },
  stale:           { bg: 'bg-muted/40',      border: 'border-border',        text: 'text-muted-foreground', dot: 'bg-muted-foreground', label: 'Stale',         pulse: false },
  in_progress:     { bg: 'bg-blue-500/15',   border: 'border-blue-500/30',   text: 'text-blue-400',         dot: 'bg-blue-400',         label: 'Running',       pulse: true  },
  queued:          { bg: 'bg-amber-500/15',  border: 'border-amber-500/30',  text: 'text-amber-400',        dot: 'bg-amber-400',        label: 'Queued',        pulse: true  },
  pending:         { bg: 'bg-amber-500/15',  border: 'border-amber-500/30',  text: 'text-amber-400',        dot: 'bg-amber-400',        label: 'Pending',       pulse: true  },
  waiting:         { bg: 'bg-amber-500/15',  border: 'border-amber-500/30',  text: 'text-amber-400',        dot: 'bg-amber-400',        label: 'Waiting',       pulse: true  },
  requested:       { bg: 'bg-muted/40',      border: 'border-border',        text: 'text-muted-foreground', dot: 'bg-muted-foreground', label: 'Requested',     pulse: false },
};

function resolveRunState(run: WorkflowRun): CIState {
  if (run.status === 'completed') return (run.conclusion as CIState) ?? 'neutral';
  return run.status as CIState;
}
function resolveCheckState(check: CheckRun): CIState {
  if (check.status === 'completed') return (check.conclusion as CIState) ?? 'neutral';
  return check.status as CIState;
}

// ─── Per-commit checks data ────────────────────────────────────────────────

interface CommitChecks {
  sha: string;
  subject: string;
  checkRuns: CheckRun[];
  legacyStatuses: CommitCombinedStatus | null;
  loading: boolean;
  error: string | null;
}

// ─── Summary ───────────────────────────────────────────────────────────────

interface Summary { success: number; failure: number; running: number; other: number }

function addToSummary(acc: Summary, state: CIState): Summary {
  if (state === 'success')                                         return { ...acc, success: acc.success + 1 };
  if (state === 'failure' || state === 'error' || state === 'timed_out') return { ...acc, failure: acc.failure + 1 };
  if (state === 'in_progress' || state === 'queued' || state === 'pending' || state === 'waiting')
                                                                   return { ...acc, running: acc.running + 1 };
  return { ...acc, other: acc.other + 1 };
}

function summariseRuns(runs: WorkflowRun[]): Summary {
  return runs.reduce<Summary>((acc, r) => addToSummary(acc, resolveRunState(r)),
    { success: 0, failure: 0, running: 0, other: 0 });
}

function summariseAllChecks(all: CommitChecks[]): Summary {
  return all.reduce<Summary>((acc, cc) => {
    const fromChecks = cc.checkRuns.reduce((a, c) => addToSummary(a, resolveCheckState(c)), acc);
    return (cc.legacyStatuses?.statuses ?? []).reduce(
      (a, s) => addToSummary(a, s.state as CIState), fromChecks);
  }, { success: 0, failure: 0, running: 0, other: 0 });
}

// ─── Shared badges ─────────────────────────────────────────────────────────

function CIBadge({ state }: { state: CIState }) {
  const c = STATE_CFG[state] ?? STATE_CFG.neutral;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border flex-shrink-0',
      c.bg, c.border, c.text,
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', c.dot, c.pulse && 'animate-pulse')} />
      {c.label}
    </span>
  );
}

const EVENT_COLORS: Record<string, string> = {
  push:              'bg-blue-500/10 border-blue-500/20 text-blue-400',
  pull_request:      'bg-purple-500/10 border-purple-500/20 text-purple-400',
  schedule:          'bg-teal-500/10 border-teal-500/20 text-teal-400',
  workflow_dispatch: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400',
  release:           'bg-green-500/10 border-green-500/20 text-green-400',
};

function EventBadge({ event }: { event: string }) {
  const cls = EVENT_COLORS[event] ?? 'bg-muted/30 border-border text-muted-foreground';
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono border capitalize flex-shrink-0',
      cls,
    )}>
      {event.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Commit section header ─────────────────────────────────────────────────

function CommitHeader({ cc, isMulti }: { cc: CommitChecks; isMulti: boolean }) {
  if (!isMulti) return null;

  // overall conclusion for this commit
  const allStates = [
    ...cc.checkRuns.map(resolveCheckState),
    ...(cc.legacyStatuses?.statuses.map(s => s.state as CIState) ?? []),
  ];
  const overall: CIState = allStates.some(s => s === 'failure' || s === 'error' || s === 'timed_out')
    ? 'failure'
    : allStates.some(s => s === 'in_progress' || s === 'queued' || s === 'pending')
    ? 'in_progress'
    : allStates.every(s => s === 'success') && allStates.length > 0
    ? 'success'
    : 'neutral';

  const cfg = STATE_CFG[overall];

  return (
    <div className={cn(
      'flex items-center gap-2 px-4 py-2 sticky top-0 z-10',
      'bg-muted/60 backdrop-blur-sm border-b border-border',
    )}>
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg.dot, cfg.pulse && 'animate-pulse')} />
      <code className="font-mono text-[11px] text-foreground/80 flex-shrink-0">{cc.sha.slice(0, 7)}</code>
      <span className="text-[11px] text-muted-foreground truncate flex-1">{cc.subject}</span>
      {allStates.length > 0 && (
        <span className="text-[10px] text-muted-foreground flex-shrink-0">
          {allStates.filter(s => s === 'success').length}/{allStates.length} passed
        </span>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b < 1024)       return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDuration(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null;
  const s = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── Run detail cache type ────────────────────────────────────────────────

interface RunDetail {
  jobs: WorkflowJob[];
  artifacts: WorkflowArtifact[];
  loading: boolean;
  error: string | null;
}

// ─── Step row ─────────────────────────────────────────────────────────────

function StepRow({ step }: { step: WorkflowJobStep }) {
  type StepState = 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'in_progress' | 'queued';
  const s: StepState = step.status === 'completed'
    ? (step.conclusion as StepState) ?? 'neutral' as unknown as StepState
    : step.status as StepState;
  const dotColor =
    s === 'success'    ? 'bg-green-400' :
    s === 'failure' || s === 'timed_out' ? 'bg-red-400' :
    s === 'in_progress' ? 'bg-blue-400 animate-pulse' :
    s === 'skipped'    ? 'bg-muted-foreground/30' :
    'bg-amber-400';

  const dur = fmtDuration(step.startedAt, step.completedAt);

  return (
    <div className="flex items-center gap-2 pl-10 pr-4 py-1 border-b border-border/20 last:border-0">
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotColor)} />
      <span className={cn(
        'flex-1 text-[11px] truncate',
        s === 'skipped' ? 'text-muted-foreground/40 line-through' : 'text-foreground/80',
      )}>
        {step.name}
      </span>
      {dur && <span className="text-[10px] text-muted-foreground flex-shrink-0">{dur}</span>}
    </div>
  );
}

// ─── Job row ──────────────────────────────────────────────────────────────

function JobRow({ job }: { job: WorkflowJob }) {
  const [open, setOpen] = useState(false);
  type JobCIState = CIState;
  const state: JobCIState = job.status === 'completed'
    ? (job.conclusion as JobCIState) ?? 'neutral'
    : job.status as JobCIState;
  const cfg = STATE_CFG[state] ?? STATE_CFG.neutral;
  const dur = fmtDuration(job.startedAt, job.completedAt);
  const hasSteps = job.steps.length > 0;

  return (
    <div>
      <button
        onClick={() => hasSteps && setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-2.5 pl-6 pr-4 py-2 border-b border-border/30',
          'hover:bg-accent/20 transition-colors text-left',
          !hasSteps && 'cursor-default',
        )}
      >
        {/* Expand chevron */}
        {hasSteps ? (
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"
            className={cn('flex-shrink-0 text-muted-foreground transition-transform duration-150', open && 'rotate-90')}>
            <path d="M4 2l4 4-4 4"/>
          </svg>
        ) : (
          <span className="w-2.5 flex-shrink-0" />
        )}

        {/* Status dot */}
        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg.dot, cfg.pulse && 'animate-pulse')} />

        {/* Name */}
        <span className="flex-1 text-xs text-foreground truncate">{job.name}</span>

        {/* Runner */}
        {job.runnerName && (
          <span className="text-[10px] text-muted-foreground/50 hidden sm:block truncate max-w-[80px]">
            {job.runnerName}
          </span>
        )}

        {/* Duration */}
        {dur && <span className="text-[10px] text-muted-foreground flex-shrink-0">{dur}</span>}

        {/* Badge */}
        <CIBadge state={state} />

        {/* External link */}
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 opacity-30 hover:opacity-70 transition-opacity"
          title="Open job log"
        >
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 10L10 2M10 2H5M10 2v5"/>
          </svg>
        </a>
      </button>

      {open && hasSteps && (
        <div className="bg-muted/10">
          {job.steps.map(s => <StepRow key={s.number} step={s} />)}
        </div>
      )}
    </div>
  );
}

// ─── Artifact chip ────────────────────────────────────────────────────────

function ArtifactChip({ artifact }: { artifact: WorkflowArtifact }) {
  if (artifact.expired) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border
                        border-border/40 bg-muted/20 text-[10px] text-muted-foreground/40 cursor-not-allowed"
        title="Artifact expired">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="opacity-50">
          <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h7a2.5 2.5 0 0 1 2.5 2.5v11.75a.75.75 0 0 1-1.5 0V2.5a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1V16.75a.75.75 0 0 1-1.5 0Z"/>
        </svg>
        {artifact.name}
        <span className="opacity-60">expired</span>
      </span>
    );
  }
  return (
    <a
      href={artifact.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border
                  border-border hover:border-primary/50 bg-muted/20 hover:bg-accent/40
                  text-[10px] text-foreground/80 hover:text-foreground
                  transition-all cursor-pointer group"
      title={`Download ${artifact.name} (${fmtBytes(artifact.sizeInBytes)})`}
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"
        className="text-muted-foreground group-hover:text-primary transition-colors">
        <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"/>
        <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.97a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.779a.749.749 0 1 1 1.06-1.06l1.97 1.97Z"/>
      </svg>
      <span className="font-medium truncate max-w-[120px]">{artifact.name}</span>
      <span className="text-muted-foreground/60">{fmtBytes(artifact.sizeInBytes)}</span>
    </a>
  );
}

// ─── Expanded run detail panel ────────────────────────────────────────────

function RunDetailPanel({
  runId,
  owner,
  repo,
  token,
  detailCache,
  onLoad,
}: {
  runId: number;
  owner: string;
  repo: string;
  token: string;
  detailCache: Map<number, RunDetail>;
  onLoad: (id: number, detail: RunDetail) => void;
}) {
  const detail = detailCache.get(runId);

  useEffect(() => {
    if (detailCache.has(runId)) return;
    // Seed loading state
    onLoad(runId, { jobs: [], artifacts: [], loading: true, error: null });
    setToken(token);
    Promise.all([
      fetchWorkflowJobs(owner, repo, runId),
      fetchWorkflowArtifacts(owner, repo, runId),
    ])
      .then(([{ jobs }, { artifacts }]) => {
        onLoad(runId, { jobs, artifacts, loading: false, error: null });
      })
      .catch(e => {
        onLoad(runId, { jobs: [], artifacts: [], loading: false, error: e.message });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  if (!detail || detail.loading) {
    return (
      <div className="flex items-center gap-2 px-6 py-3 text-[11px] text-muted-foreground bg-muted/10 border-b border-border/40">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="animate-spin opacity-50">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" opacity=".2"/>
          <path d="M8 1a7 7 0 0 1 7 7h-1.5A5.5 5.5 0 0 0 8 2.5V1z"/>
        </svg>
        Loading jobs…
      </div>
    );
  }

  if (detail.error) {
    return (
      <div className="px-6 py-2 text-[11px] text-red-400 bg-muted/10 border-b border-border/40">
        ⚠ {detail.error}
      </div>
    );
  }

  return (
    <div className="border-b border-border/50 bg-muted/5">
      {/* Jobs */}
      {detail.jobs.length > 0 && (
        <div>
          <div className="px-6 pt-2 pb-1 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
            Jobs ({detail.jobs.length})
          </div>
          {detail.jobs.map(j => <JobRow key={j.id} job={j} />)}
        </div>
      )}

      {detail.jobs.length === 0 && (
        <div className="px-6 py-2 text-[11px] text-muted-foreground/50">No jobs found</div>
      )}

      {/* Artifacts */}
      {detail.artifacts.length > 0 && (
        <div className="px-4 py-2.5 flex flex-wrap gap-1.5 border-t border-border/30">
          <span className="text-[10px] text-muted-foreground/60 self-center mr-1 flex-shrink-0">
            📦 Artifacts:
          </span>
          {detail.artifacts.map(a => <ArtifactChip key={a.id} artifact={a} />)}
        </div>
      )}
    </div>
  );
}

// ─── Row components ────────────────────────────────────────────────────────

function WorkflowRunRow({
  run,
  animate,
  owner,
  repo,
  token,
  detailCache,
  onDetailLoad,
}: {
  run: WorkflowRun;
  animate: boolean;
  owner: string;
  repo: string;
  token: string;
  detailCache: Map<number, RunDetail>;
  onDetailLoad: (id: number, detail: RunDetail) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const state = resolveRunState(run);

  return (
    <div className={cn(
      'border-b border-border/50',
      animate && 'animate-in fade-in slide-in-from-bottom-1 duration-200',
    )}>
      {/* Summary row — click to expand */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left group"
      >
        {/* Expand chevron */}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"
          className={cn(
            'flex-shrink-0 mt-1 text-muted-foreground transition-transform duration-150',
            expanded ? 'rotate-90' : 'rotate-0',
          )}>
          <path d="M4 2l4 4-4 4"/>
        </svg>

        <div className="flex-shrink-0 mt-0.5"><CIBadge state={state} /></div>

        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
              {run.workflowName}
            </span>
            <span className="text-xs text-muted-foreground font-mono">#{run.runNumber}</span>
            {run.runAttempt > 1 && (
              <span className="text-[10px] text-muted-foreground border border-border px-1 rounded">
                attempt {run.runAttempt}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
            <EventBadge event={run.event} />
            {run.headBranch && (
              <span className="inline-flex items-center gap-1">
                <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" className="opacity-60">
                  <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6h.75a.75.75 0 0 1 0 1.5H12v1.128a2.251 2.251 0 1 1-1.5 0V7.5h-1.25a.75.75 0 0 1 0-1.5H10V5.372A2.25 2.25 0 0 1 9.5 3.25Zm-5 3a2.25 2.25 0 1 1 3 2.122v3.756a2.251 2.251 0 1 1-1.5 0V8.372A2.25 2.25 0 0 1 4.5 6.25Z"/>
                </svg>
                <span className="font-mono truncate max-w-[100px]">{run.headBranch}</span>
              </span>
            )}
            {run.actor && <span>by {run.actor.login}</span>}
            <span>{timeAgo(run.updatedAt)}</span>
            <code className="text-[10px] text-muted-foreground/60 font-mono">{run.headSha.slice(0, 7)}</code>
          </div>
        </div>

        {/* External link — doesn't toggle expand */}
        <a
          href={run.url}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 opacity-0 group-hover:opacity-40 hover:!opacity-80 transition-opacity mt-1"
          title="Open on GitHub"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 10L10 2M10 2H5M10 2v5"/>
          </svg>
        </a>
      </button>

      {/* Drill-down panel */}
      {expanded && (
        <RunDetailPanel
          runId={run.id}
          owner={owner}
          repo={repo}
          token={token}
          detailCache={detailCache}
          onLoad={onDetailLoad}
        />
      )}
    </div>
  );
}

function CheckRunRow({ check }: { check: CheckRun }) {
  const state = resolveCheckState(check);
  const cfg = STATE_CFG[state] ?? STATE_CFG.neutral;
  let duration: string | null = null;
  if (check.startedAt && check.completedAt) {
    const s = Math.round((new Date(check.completedAt).getTime() - new Date(check.startedAt).getTime()) / 1000);
    duration = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }
  return (
    <a
      href={check.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 hover:bg-accent/30 transition-colors cursor-pointer group animate-in fade-in duration-150"
    >
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg.dot, cfg.pulse && 'animate-pulse')} />
      <span className="flex-1 text-xs text-foreground truncate group-hover:text-primary transition-colors">{check.name}</span>
      {check.app && (
        <span className="text-[10px] text-muted-foreground/60 truncate max-w-[80px] hidden sm:block">{check.app.name}</span>
      )}
      {duration && <span className="text-[10px] text-muted-foreground flex-shrink-0">{duration}</span>}
      <CIBadge state={state} />
      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
        className="flex-shrink-0 opacity-0 group-hover:opacity-40">
        <path d="M2 10L10 2M10 2H5M10 2v5"/>
      </svg>
    </a>
  );
}

function LegacyStatusRow({ status }: { status: CommitCombinedStatus['statuses'][0] }) {
  const cfg = STATE_CFG[status.state as CIState] ?? STATE_CFG.neutral;
  return (
    <a
      href={status.targetUrl ?? undefined}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 border-b border-border/40 hover:bg-accent/30 transition-colors group animate-in fade-in duration-150',
        status.targetUrl ? 'cursor-pointer' : 'cursor-default',
      )}
    >
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg.dot, cfg.pulse && 'animate-pulse')} />
      <span className="flex-1 text-xs text-foreground truncate font-mono group-hover:text-primary transition-colors">{status.context}</span>
      {status.description && (
        <span className="text-[10px] text-muted-foreground truncate max-w-[160px] hidden sm:block">{status.description}</span>
      )}
      <CIBadge state={status.state as CIState} />
      {status.targetUrl && (
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
          className="flex-shrink-0 opacity-0 group-hover:opacity-40">
          <path d="M2 10L10 2M10 2H5M10 2v5"/>
        </svg>
      )}
    </a>
  );
}

// ─── Per-commit checks block ───────────────────────────────────────────────

function CommitChecksBlock({ cc, isMulti }: { cc: CommitChecks; isMulti: boolean }) {
  return (
    <div className={cn(isMulti && 'border-b border-border/60 pb-1 mb-1 last:border-b-0')}>
      <CommitHeader cc={cc} isMulti={isMulti} />

      {cc.loading && (
        <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-muted-foreground">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="animate-spin opacity-60 flex-shrink-0">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" opacity=".2"/>
            <path d="M8 1a7 7 0 0 1 7 7h-1.5A5.5 5.5 0 0 0 8 2.5V1z"/>
          </svg>
          Loading checks…
        </div>
      )}

      {cc.error && (
        <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-red-400">
          <span>⚠</span>
          <span className="truncate">{cc.error}</span>
        </div>
      )}

      {!cc.loading && !cc.error && (
        <>
          {cc.checkRuns.length === 0 && !cc.legacyStatuses && (
            <div className={cn(
              'flex items-center gap-2 px-4 text-[11px] text-muted-foreground/50',
              isMulti ? 'py-2' : 'py-12 justify-center flex-col',
            )}>
              {!isMulti && <span className="text-2xl opacity-30">✓</span>}
              <span>No checks for this commit</span>
            </div>
          )}

          {cc.checkRuns.length > 0 && (
            <>
              {isMulti && (
                <div className="px-4 pt-2 pb-1 text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                  Check Runs
                </div>
              )}
              {!isMulti && (
                <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Check Runs
                </div>
              )}
              {cc.checkRuns.map(c => <CheckRunRow key={c.id} check={c} />)}
            </>
          )}

          {cc.legacyStatuses && cc.legacyStatuses.statuses.length > 0 && (
            <>
              <div className={cn(
                'px-4 pb-1.5 text-muted-foreground uppercase tracking-wider border-t border-border mt-1',
                isMulti ? 'pt-2 text-[9px] font-semibold opacity-60' : 'pt-3 text-[10px] font-semibold',
              )}>
                Status Checks
              </div>
              {cc.legacyStatuses.statuses.map((s, i) => (
                <LegacyStatusRow key={`${s.context}-${i}`} status={s} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="animate-spin opacity-60">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" opacity=".2"/>
        <path d="M8 1a7 7 0 0 1 7 7h-1.5A5.5 5.5 0 0 0 8 2.5V1z"/>
      </svg>
      Loading…
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

type ActiveTab = 'runs' | 'checks';

export default function CIStatusTab() {
  const { state } = useAppContext();
  const { repoInfo, token, selectedNode, selectedNodes } = state;

  const [tab, setTab] = useState<ActiveTab>('runs');
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [animateItems, setAnimateItems] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [errorRuns, setErrorRuns] = useState<string | null>(null);

  // Per-run drill-down cache: Map<runId, RunDetail>
  const [detailCache, setDetailCache] = useState<Map<number, RunDetail>>(new Map());

  const handleDetailLoad = useCallback((id: number, detail: RunDetail) => {
    setDetailCache(prev => new Map(prev).set(id, detail));
  }, []);

  // Per-commit checks: Map<sha, CommitChecks>
  const [checksMap, setChecksMap] = useState<Map<string, CommitChecks>>(new Map());

  const runsLoadedFor = useRef<string | null>(null);
  const fetchingSet   = useRef<Set<string>>(new Set()); // SHAs currently in-flight

  // Determine active SHAs to show in Checks tab.
  // Multi-select takes priority; else single selected node.
  const activeSHAs: { sha: string; subject: string }[] = (() => {
    if (selectedNodes.length > 1) {
      return selectedNodes.map(n => ({ sha: n.commit.sha, subject: n.commit.subject }));
    }
    if (selectedNode) {
      return [{ sha: selectedNode.commit.sha, subject: selectedNode.commit.subject }];
    }
    return [];
  })();

  const isMulti = activeSHAs.length > 1;

  // ── Fetch workflow runs ────────────────────────────────────────────────
  useEffect(() => {
    if (!repoInfo) return;
    const key = `${repoInfo.owner}/${repoInfo.repo}`;
    if (runsLoadedFor.current === key) return;
    runsLoadedFor.current = key;

    setToken(token);
    setLoadingRuns(true);
    setErrorRuns(null);
    setAnimateItems(false);

    fetchWorkflowRuns(repoInfo.owner, repoInfo.repo)
      .then(({ runs: r }) => { setRuns(r); setAnimateItems(true); })
      .catch(e => { setErrorRuns(e.message); runsLoadedFor.current = null; })
      .finally(() => setLoadingRuns(false));
  }, [repoInfo, token]);

  // ── Fetch checks for all active SHAs not yet cached ───────────────────
  useEffect(() => {
    if (!repoInfo || activeSHAs.length === 0) return;
    setToken(token);

    for (const { sha, subject } of activeSHAs) {
      if (checksMap.has(sha) || fetchingSet.current.has(sha)) continue;
      fetchingSet.current.add(sha);

      // Seed loading state immediately
      setChecksMap(prev => new Map(prev).set(sha, {
        sha, subject, checkRuns: [], legacyStatuses: null, loading: true, error: null,
      }));

      Promise.all([
        fetchCommitCheckRuns(repoInfo.owner, repoInfo.repo, sha),
        fetchCommitStatus(repoInfo.owner, repoInfo.repo, sha),
      ])
        .then(([{ checkRuns }, combined]) => {
          setChecksMap(prev => new Map(prev).set(sha, {
            sha,
            subject,
            checkRuns,
            legacyStatuses: combined.totalCount > 0 ? combined : null,
            loading: false,
            error: null,
          }));
        })
        .catch(e => {
          setChecksMap(prev => new Map(prev).set(sha, {
            sha, subject, checkRuns: [], legacyStatuses: null, loading: false, error: e.message,
          }));
        })
        .finally(() => fetchingSet.current.delete(sha));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoInfo, token, activeSHAs.map(s => s.sha).join(',')]);

  // ── Auto-switch to Checks when selection changes ───────────────────────
  useEffect(() => {
    if (activeSHAs.length > 0) setTab('checks');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSHAs.map(s => s.sha).join(',')]);

  // ── Refresh handler ────────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    runsLoadedFor.current = null;
    fetchingSet.current.clear();
    setChecksMap(new Map());
    setDetailCache(new Map());
    setRuns([]);
    setAnimateItems(false);
    if (!repoInfo) return;
    setToken(token);
    setLoadingRuns(true);
    setErrorRuns(null);
    fetchWorkflowRuns(repoInfo.owner, repoInfo.repo)
      .then(({ runs: r }) => { setRuns(r); setAnimateItems(true); })
      .catch(e => setErrorRuns(e.message))
      .finally(() => setLoadingRuns(false));
  }, [repoInfo, token]);

  if (!repoInfo) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground">
        <span className="text-3xl opacity-20">⚡</span>
        <span className="text-sm">No repository loaded</span>
      </div>
    );
  }

  // Ordered list of CommitChecks for active SHAs (preserves selection order)
  const activeChecks = activeSHAs
    .map(({ sha }) => checksMap.get(sha))
    .filter((cc): cc is CommitChecks => cc !== undefined);

  const runsSummary  = summariseRuns(runs);
  const checksSummary = summariseAllChecks(activeChecks);
  const totalCheckCount = activeChecks.reduce((n, cc) =>
    n + cc.checkRuns.length + (cc.legacyStatuses?.totalCount ?? 0), 0);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0 border-b border-border flex-shrink-0 bg-muted/20">
        {([
          ['runs',   'Workflow Runs', runs.length],
          ['checks', 'Checks',        activeSHAs.length > 0 ? totalCheckCount : null],
        ] as const).map(([id, label, count]) => (
          <button
            key={id}
            onClick={() => setTab(id as ActiveTab)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2',
              tab === id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {count != null && count > 0 && (
              <span className={cn(
                'px-1.5 py-0.5 rounded-full text-[9px] font-semibold',
                tab === id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
              )}>
                {count}
              </span>
            )}
          </button>
        ))}

        <div className="flex-1" />

        {/* Multi-select indicator */}
        {isMulti && tab === 'checks' && (
          <span className="text-[10px] text-muted-foreground mr-2 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
            {activeSHAs.length} commits
          </span>
        )}

        {/* Refresh */}
        <button
          onClick={handleRefresh}
          title="Refresh"
          className="px-2 py-1 mr-2 text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-accent/50"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
            <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
          </svg>
        </button>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Workflow Runs tab */}
        {tab === 'runs' && (
          <>
            {loadingRuns && <Spinner />}
            {errorRuns && (
              <div className="flex flex-col items-center justify-center py-16 gap-2 px-4 text-center">
                <span className="text-2xl">⚠️</span>
                <p className="text-sm text-red-400">{errorRuns}</p>
                {!token && (
                  <p className="text-xs text-muted-foreground">
                    A GitHub token is required to access Actions data.
                  </p>
                )}
              </div>
            )}
            {!loadingRuns && !errorRuns && runs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <span className="text-2xl opacity-30">⚡</span>
                <span className="text-sm">No workflow runs found</span>
              </div>
            )}
            {!loadingRuns && !errorRuns && runs.map(run => (
              <WorkflowRunRow
                key={run.id}
                run={run}
                animate={animateItems}
                owner={repoInfo.owner}
                repo={repoInfo.repo}
                token={token}
                detailCache={detailCache}
                onDetailLoad={handleDetailLoad}
              />
            ))}
          </>
        )}

        {/* Checks tab */}
        {tab === 'checks' && (
          <>
            {activeSHAs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <span className="text-2xl opacity-30">🔍</span>
                <span className="text-sm">Select a commit to see its checks</span>
                <span className="text-xs opacity-50">Shift-click for multiple</span>
              </div>
            )}

            {activeSHAs.length > 0 && activeChecks.length < activeSHAs.length && (
              // some commits not yet seeded in map — show spinner
              <Spinner />
            )}

            {activeChecks.map(cc => (
              <CommitChecksBlock key={cc.sha} cc={cc} isMulti={isMulti} />
            ))}
          </>
        )}
      </div>

      {/* ── Footer stats ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 py-1.5 border-t border-border bg-muted/20
                      text-[10px] text-muted-foreground flex items-center gap-3">
        {tab === 'runs' ? (
          runs.length > 0 ? (
            <>
              <span className="text-green-400">{runsSummary.success} passed</span>
              {runsSummary.failure > 0 && <span className="text-red-400">{runsSummary.failure} failed</span>}
              {runsSummary.running > 0 && <span className="text-blue-400 animate-pulse">{runsSummary.running} running</span>}
              {runsSummary.other   > 0 && <span>{runsSummary.other} other</span>}
            </>
          ) : <span>No runs</span>
        ) : (
          activeSHAs.length > 0 && totalCheckCount > 0 ? (
            <>
              {isMulti && (
                <span className="opacity-50">{activeSHAs.length} commits ·</span>
              )}
              <span className="text-green-400">{checksSummary.success} passed</span>
              {checksSummary.failure > 0 && <span className="text-red-400">{checksSummary.failure} failed</span>}
              {checksSummary.running > 0 && <span className="text-blue-400 animate-pulse">{checksSummary.running} running</span>}
              {checksSummary.other   > 0 && <span>{checksSummary.other} other</span>}
            </>
          ) : <span>No checks</span>
        )}
      </div>
    </div>
  );
}
