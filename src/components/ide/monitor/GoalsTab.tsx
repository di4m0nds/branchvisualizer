import { useState } from 'react';
import {
  Check, ChevronDown, ChevronRight, CircleDashed, CircleDot, Pause, Play, Trash2, X, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAppState, useAppDispatch, useAppSelector } from '@/store/store';
import { removeRun, useGoalRuns } from '@/lib/goals/goalStore';
import { activeExecutors, resumeGoal } from '@/lib/goals/executor';
import { closeSession } from '@/lib/sessionLifecycle';
import { formatCost } from '@/lib/agent/pricing';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { GoalRun, GoalTask } from '@/types/goals';

// ─── Goal-run dashboard (Monitor → Goals) ────────────────────────────────────
// Live view of every goal run: progress, task list with deps/attempts, event
// log tail, cost, and the control surface (approve plan/task, pause, resume,
// cancel). Approvals resolve through the live executor; Resume re-creates one
// from the on-disk checkpoint after a pause or app restart.

const STATUS_TONE: Record<GoalRun['status'], string> = {
  planning: 'text-blue-400 border-blue-400/40 bg-blue-400/10',
  awaiting_plan_approval: 'text-amber-400 border-amber-400/40 bg-amber-400/10',
  running: 'text-green-500 border-green-500/40 bg-green-500/10',
  awaiting_approval: 'text-amber-400 border-amber-400/40 bg-amber-400/10',
  paused: 'text-orange-400 border-orange-400/40 bg-orange-400/10',
  completed: 'text-green-400 border-green-400/40 bg-green-400/10',
  failed: 'text-red-400 border-red-400/40 bg-red-400/10',
  cancelled: 'text-muted-foreground border-border bg-muted/20',
};

function TaskRow({ task }: { task: GoalTask }) {
  const icon = task.status === 'done' ? <Check className="w-3 h-3 text-green-500" />
    : task.status === 'in_progress' ? <CircleDot className="w-3 h-3 text-blue-400 animate-pulse" />
    : task.status === 'failed' ? <XCircle className="w-3 h-3 text-red-400" />
    : task.status === 'blocked' ? <XCircle className="w-3 h-3 text-orange-400" />
    : task.status === 'skipped' ? <X className="w-3 h-3 text-muted-foreground" />
    : <CircleDashed className="w-3 h-3 text-muted-foreground/50" />;
  return (
    <div className="flex items-start gap-1.5 px-2 py-1">
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-[11px] leading-snug', task.status === 'done' ? 'text-muted-foreground line-through decoration-muted-foreground/40' : 'text-foreground/85')}>
          <span className="font-mono text-muted-foreground/60">{task.id}</span> {task.title}
          {task.needsApproval && <span className="ml-1 text-[9px] text-amber-400">⋄ approval</span>}
        </p>
        {task.deps.length > 0 && (
          <p className="text-[9px] font-mono text-muted-foreground/40">after {task.deps.join(', ')}</p>
        )}
        {task.resultSummary && task.status !== 'pending' && (
          <p className="text-[10px] text-muted-foreground/60 leading-snug">{task.resultSummary}</p>
        )}
        {task.verify?.command && (
          <p className={cn('text-[9px] font-mono', task.verify.passed ? 'text-green-500/70' : task.verify.passed === false ? 'text-red-400/80' : 'text-muted-foreground/40')}>
            verify: {task.verify.command}{task.verify.passed === true ? ' ✓' : task.verify.passed === false ? ' ✗' : ''}
          </p>
        )}
      </div>
      {task.attempts > 1 && (
        <span className="text-[9px] font-mono text-muted-foreground/50">×{task.attempts}</span>
      )}
    </div>
  );
}

function RunCard({ run }: { run: GoalRun }) {
  const dispatch = useAppDispatch();
  const project = useAppSelector((s) => s.projects.find((p) => p.id === run.projectId) ?? null);
  const [open, setOpen] = useState(
    ['planning', 'running', 'awaiting_approval', 'awaiting_plan_approval', 'paused'].includes(run.status),
  );
  const [showEvents, setShowEvents] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const terminal = ['completed', 'cancelled', 'failed'].includes(run.status);

  const deleteRun = () => {
    setConfirmDelete(false);
    if (!project) return;
    void removeRun(project, run.id);
    // Also drop the run's dedicated transcript session if it still exists.
    if (getAppState().sessions.some((s) => s.id === run.sessionId)) {
      closeSession(run.sessionId);
    }
  };

  const doneCount = run.tasks.filter((t) => t.status === 'done' || t.status === 'skipped').length;
  const pct = run.tasks.length ? Math.round((doneCount / run.tasks.length) * 100) : 0;
  const executor = activeExecutors.get(run.id);
  const live = ['planning', 'running', 'awaiting_approval', 'awaiting_plan_approval'].includes(run.status);

  const resume = () => {
    if (!project) return;
    resumeGoal(project, run, dispatch);
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2 bg-muted/10">
        <button onClick={() => setOpen((v) => !v)} className="text-muted-foreground hover:text-foreground">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <button
          className="text-xs font-medium text-foreground truncate flex-1 text-left hover:underline"
          onClick={() => dispatch({ type: 'SET_ACTIVE_SESSION', id: run.sessionId })}
          title="Open the run's session transcript"
        >
          {run.goal}
        </button>
        <span className={cn('px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider whitespace-nowrap', STATUS_TONE[run.status])}>
          {run.status.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted/30">
        <div
          className={cn('h-full transition-all', run.status === 'failed' ? 'bg-red-400/70' : 'bg-primary/70')}
          style={{ width: `${pct}%` }}
        />
      </div>

      {open && (
        <div className="p-2 space-y-2">
          {/* Controls */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {run.status === 'awaiting_plan_approval' && executor && (
              <button
                onClick={() => void executor.approvePlan()}
                className="flex items-center gap-1 px-2 py-1 rounded border border-green-500/40 text-green-500 bg-green-500/10 text-[10px] hover:bg-green-500/20"
              >
                <Check className="w-3 h-3" /> Approve plan
              </button>
            )}
            {run.status === 'awaiting_approval' && run.pendingApproval && executor && (
              <>
                <span className="text-[10px] text-amber-400 truncate max-w-[260px]" title={run.pendingApproval.description}>
                  {run.pendingApproval.description}
                </span>
                <button
                  onClick={() => executor.resolveApproval(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-green-500/40 text-green-500 bg-green-500/10 text-[10px]"
                >
                  <Check className="w-3 h-3" /> Approve
                </button>
                <button
                  onClick={() => executor.resolveApproval(false)}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-red-400/40 text-red-400 text-[10px]"
                >
                  <X className="w-3 h-3" /> Deny
                </button>
              </>
            )}
            {run.status === 'paused' && (
              <button
                onClick={resume}
                className="flex items-center gap-1 px-2 py-1 rounded border border-primary/40 text-primary bg-primary/10 text-[10px] hover:bg-primary/20"
                title={run.pauseReason ? `Paused: ${run.pauseReason}` : undefined}
              >
                <Play className="w-3 h-3" /> Resume
              </button>
            )}
            {/* A live run whose in-process executor didn't survive a restart
                (e.g. awaiting_plan_approval reloaded from disk) — Resume rebuilds
                it so the run isn't stuck with no actionable control. */}
            {live && !executor && (
              <button
                onClick={resume}
                className="flex items-center gap-1 px-2 py-1 rounded border border-primary/40 text-primary bg-primary/10 text-[10px] hover:bg-primary/20"
                title="This run's executor didn't survive a restart — resume it."
              >
                <Play className="w-3 h-3" /> Resume
              </button>
            )}
            {live && executor && (
              <button
                onClick={() => void executor.pause()}
                className="flex items-center gap-1 px-2 py-1 rounded border border-border text-muted-foreground text-[10px] hover:text-foreground"
              >
                <Pause className="w-3 h-3" /> Pause
              </button>
            )}
            {!terminal && executor && (
              <button
                onClick={() => void executor.cancel()}
                className="flex items-center gap-1 px-2 py-1 rounded border border-border text-muted-foreground text-[10px] hover:text-red-400 hover:border-red-400/40"
              >
                <X className="w-3 h-3" /> Cancel
              </button>
            )}
            {terminal && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1 px-2 py-1 rounded border border-border text-muted-foreground text-[10px] hover:text-red-400 hover:border-red-400/40"
                title="Remove this run permanently"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            )}
            <span className="ml-auto text-[10px] font-mono text-muted-foreground/60 tabular-nums whitespace-nowrap">
              {doneCount}/{run.tasks.length} tasks
              {run.usage.costUSD > 0 && <> · ≈{formatCost(run.usage.costUSD)}</>}
            </span>
          </div>
          {run.pauseReason && run.status === 'paused' && (
            <p className="text-[10px] text-orange-400/80">Paused: {run.pauseReason}</p>
          )}

          {/* Task list */}
          {run.tasks.length > 0 ? (
            <div className="rounded border border-border/60 divide-y divide-border/40">
              {run.tasks.map((t) => <TaskRow key={t.id} task={t} />)}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/60">Planning…</p>
          )}

          {/* Event log tail */}
          <button
            onClick={() => setShowEvents((v) => !v)}
            className="text-[9px] uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground"
          >
            {showEvents ? 'hide' : 'show'} events ({run.events.length})
          </button>
          {showEvents && (
            <div className="rounded border border-border/60 max-h-40 overflow-y-auto px-2 py-1 font-mono text-[9.5px] text-muted-foreground/70 space-y-0.5">
              {run.events.slice(-60).map((e, i) => (
                <div key={i}><span className="opacity-50">{e.ts.slice(11, 19)}</span> [{e.kind}] {e.detail}</div>
              ))}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this goal run?"
        description="Removes the run, its checkpoint file, and its transcript session. This cannot be undone."
        confirmLabel="Delete run"
        variant="destructive"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={deleteRun}
      />
    </div>
  );
}

export default function GoalsTab() {
  const runs = useGoalRuns();

  if (runs.length === 0) {
    return (
      <div className="p-4">
        <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
          No goal runs yet. Type a high-level objective in the composer and press the target
          button ("Run as goal") — the agent plans it into tasks, executes them autonomously
          with checkpoints, and resumes here after interruptions.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {[...runs]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((run) => <RunCard key={run.id} run={run} />)}
    </div>
  );
}
