import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppDispatch } from '@/store/store';
import PinnedRulesEditor from './PinnedRulesEditor';
import SandboxToggle from './SandboxToggle';
import type {
  AccessLevel, BuildMode, ReasoningBudget, Session,
} from '@/types/session';

// Reuses the visual language of the GitHub rate-limit pill (RepoSearch) for the
// context-token meter and renders the full `<session_context>` posture.

const ACCESS_LEVELS: { id: AccessLevel; label: string; hint: string }[] = [
  { id: 'supervised', label: 'Supervised', hint: 'Approve every action' },
  { id: 'auto_accept', label: 'Auto-accept', hint: 'Auto files · gate commands' },
  { id: 'full_access', label: 'Full access', hint: 'Autonomous (except pinned rules)' },
];

const BUDGETS: ReasoningBudget[] = ['low', 'medium', 'high', 'max'];

function Segmented<T extends string>({
  value, options, onChange, title,
}: {
  value: T;
  options: { id: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  title?: string;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border bg-muted/30" title={title}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          title={o.hint}
          className={cn(
            'px-2 py-1 rounded text-[11px] font-medium transition-colors capitalize',
            value === o.id ? 'bg-accent text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SessionContextBar({ session }: { session: Session }) {
  const dispatch = useAppDispatch();
  const [editorOpen, setEditorOpen] = useState(false);
  const { context: ctx } = session;
  const id = session.id;

  const pct = ctx.contextTokens.max
    ? Math.min(100, Math.round((ctx.contextTokens.used / ctx.contextTokens.max) * 100))
    : 0;
  const tokWarn = pct >= 80;
  const tokHigh = pct >= 90;

  return (
    <div className="flex flex-wrap items-center gap-2 gap-y-1.5 px-3 py-2 border-b border-border bg-muted/10 text-xs">
      {/* Access level */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground hidden md:inline">Access</span>
        <Segmented<AccessLevel>
          value={ctx.accessLevel}
          options={ACCESS_LEVELS}
          onChange={(level) => dispatch({ type: 'SET_ACCESS_LEVEL', sessionId: id, level })}
        />
      </div>

      {/* Build mode */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground hidden md:inline">Mode</span>
        <Segmented<BuildMode>
          value={ctx.buildMode}
          options={[{ id: 'direct', label: 'Direct' }, { id: 'planning', label: 'Planning' }]}
          onChange={(mode) => dispatch({ type: 'SET_BUILD_MODE', sessionId: id, mode })}
        />
      </div>

      {/* Reasoning budget */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground hidden md:inline">Effort</span>
        <Segmented<ReasoningBudget>
          value={ctx.reasoningBudget}
          options={BUDGETS.map((b) => ({ id: b, label: b }))}
          onChange={(budget) => dispatch({ type: 'SET_REASONING_BUDGET', sessionId: id, budget })}
          title="Reasoning effort"
        />
      </div>

      {/* Deep flags */}
      <div className="flex items-center gap-1">
        {([
          ['deepThinking', 'Think'],
          ['deepCoding', 'Code'],
          ['fastMode', 'Fast'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => dispatch({ type: 'PATCH_SESSION_CONTEXT', sessionId: id, patch: { [key]: !ctx[key] } })}
            className={cn(
              'px-1.5 py-1 rounded text-[10px] border transition-colors',
              ctx[key]
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
            title={key}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Podman runtime sandbox */}
      <SandboxToggle session={session} />

      <div className="h-4 w-px bg-border hidden md:block" />

      {/* Skills */}
      <div className="flex items-center gap-1 flex-wrap">
        {ctx.skills.map((sk) => (
          <button
            key={sk.id}
            onClick={() => dispatch({ type: 'TOGGLE_SKILL', sessionId: id, skillId: sk.id })}
            title={sk.description}
            className={cn(
              'px-1.5 py-0.5 rounded-full text-[10px] font-mono border transition-colors',
              sk.enabled
                ? 'border-green-500/40 bg-green-500/10 text-green-500'
                : 'border-border text-muted-foreground/60 hover:text-foreground',
            )}
          >
            {sk.name}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Pinned rules — click to edit (app-global CRUD; new sessions inherit) */}
        <button
          onClick={() => setEditorOpen(true)}
          className={cn(
            'flex items-center gap-1 text-[10px] transition-colors',
            ctx.pinnedRules.length > 0 ? 'text-amber-500 hover:text-amber-400' : 'text-muted-foreground hover:text-foreground',
          )}
          title={ctx.pinnedRules.length ? ctx.pinnedRules.map((r) => `• ${r.text}`).join('\n') : 'No pinned rules — click to add'}
        >
          <LockIcon className="h-3 w-3" />
          {ctx.pinnedRules.length} pinned · edit
        </button>
        <PinnedRulesEditor open={editorOpen} onClose={() => setEditorOpen(false)} sessionId={id} />

        {/* Context-token meter */}
        <div
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-mono tabular-nums',
            tokHigh ? 'border-red-500/40 bg-red-500/10 text-red-400'
              : tokWarn ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                : 'border-border bg-muted/30 text-muted-foreground',
          )}
          title={`${ctx.contextTokens.used.toLocaleString()} / ${ctx.contextTokens.max.toLocaleString()} tokens`}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', tokHigh ? 'bg-red-400' : tokWarn ? 'bg-amber-400' : 'bg-green-400')} />
          {pct}%
        </div>
      </div>
    </div>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
