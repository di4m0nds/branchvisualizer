import { useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from '@/services/toast';
import { useAppContext } from '@/store/AppContext';
import { useRepoData } from '@/hooks/useRepoData';
import AgentBlocks from './AgentBlocks';
import type { AgentTransport } from '@/lib/agent/transport';
import { createTransportFor } from '@/lib/agent/providers';
import { runAgentTurn, type PendingAction } from '@/lib/agent/loop';
import type { AgentMessage, Session } from '@/types/session';
import type { LogDensity } from '@/types';

// ─── Pending-action approval card ────────────────────────────────────────────

function PendingActionCard({
  pending, onApprove, onDeny,
}: {
  pending: PendingAction;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const riskColor = pending.risk === 'high' ? 'text-red-400' : pending.risk === 'medium' ? 'text-amber-400' : 'text-green-400';
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-foreground">Approve action</span>
        <span className={cn('font-mono', riskColor)}>{pending.risk} risk</span>
      </div>
      <div className="text-xs text-muted-foreground">
        <span className="font-mono text-foreground">{pending.toolName}</span> — {pending.description}
      </div>
      {pending.toolName === 'run_command' && (
        <pre className="text-[11px] font-mono bg-background rounded border border-border px-2 py-1 overflow-auto">
          {String(pending.input.command)}
        </pre>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button size="xs" onClick={onApprove}>Approve</Button>
        <Button size="xs" variant="outline" onClick={onDeny}>Deny</Button>
      </div>
    </div>
  );
}

// ─── Message bubble ──────────────────────────────────────────────────────────

function MessageView({ msg, density, interactive, onSubmitAnswers }: {
  msg: AgentMessage;
  density: LogDensity;
  interactive: boolean;
  onSubmitAnswers: (text: string) => void;
}) {
  const isUser = msg.role === 'user';
  const isActionLog = msg.blocks.length > 0 && msg.blocks.every((b) => b.type === 'action_log');
  return (
    <div className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      {!isActionLog && (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
          {isUser ? 'You' : 'Agent'}{msg.streaming ? ' · …' : ''}
        </span>
      )}
      <div className={cn(
        'max-w-full min-w-0 rounded-lg px-3 py-2 text-sm',
        isUser ? 'bg-primary/10 border border-primary/20' : isActionLog ? 'w-full' : 'bg-muted/30 border border-border w-full',
      )}>
        {isUser
          ? <p className="whitespace-pre-wrap text-foreground/90">{msg.text}</p>
          : <AgentBlocks
              blocks={msg.blocks.length ? msg.blocks : [{ type: 'text', raw: msg.text }]}
              density={density}
              interactive={interactive}
              onSubmitAnswers={onSubmitAnswers}
            />}
      </div>
    </div>
  );
}

// ─── Chat panel ──────────────────────────────────────────────────────────────

export default function ChatPanel({ session }: { session: Session }) {
  const { state, dispatch } = useAppContext();
  const { loadRepo, loadLocalRepo } = useRepoData();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const approvalResolver = useRef<((ok: boolean) => void) | null>(null);
  const transportRef = useRef<AgentTransport | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Always read the freshest session from state (props may be a stale snapshot).
  const live = state.sessions.find((s) => s.id === session.id) ?? session;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [live.messages]);

  function requestApproval(p: PendingAction): Promise<boolean> {
    setPending(p);
    return new Promise<boolean>((resolve) => {
      approvalResolver.current = (ok) => {
        approvalResolver.current = null;
        setPending(null);
        resolve(ok);
      };
    });
  }

  function onSideEffect(kind: string) {
    if (kind !== 'branch_visualizer_refresh' && kind !== 'editor_sync') return;
    if (live.repoSource === 'local' && live.cwd) loadLocalRepo(live.cwd).catch(() => {});
    else if (state.repoInfo) loadRepo(`https://github.com/${state.repoInfo.fullName}`).catch(() => {});
  }

  async function runTurn(text: string) {
    if (!text || busy) return;
    setBusy(true);
    try {
      const { providerId, modelId } = state.currentModel;
      const key = `${providerId}:${modelId}`;
      if (!transportRef.current || transportRef.current.id !== providerId || transportRef.current.modelId !== modelId) {
        transportRef.current = await createTransportFor(providerId, modelId);
      }
      void key;
      const ts = new Date().toISOString();
      // Re-read the freshest session at call time (build mode may have flipped).
      const current = state.sessions.find((s) => s.id === session.id) ?? live;
      await runAgentTurn(current, text, {
        transport: transportRef.current,
        dispatch,
        requestApproval,
        onSideEffect,
      }, ts);
    } catch (e) {
      toast.error('Agent error', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    runTurn(text);
  }

  function approvePlan() {
    // Planning mode: approve → switch to direct execution → replay as instruction.
    dispatch({ type: 'SET_BUILD_MODE', sessionId: live.id, mode: 'direct' });
    runTurn('The plan is approved. Proceed with the implementation, executing the steps in order.');
  }

  // Show the plan-approval affordance when the last assistant turn produced a plan
  // while in planning mode.
  const last = live.messages[live.messages.length - 1];
  const showApprovePlan =
    live.context.buildMode === 'planning'
    && !busy
    && !!last
    && last.role === 'assistant'
    && !last.streaming
    && last.blocks.some((b) => b.type === 'plan');

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {live.messages.length === 0 && (
          <div className="h-full flex items-center justify-center text-center text-xs text-muted-foreground/60 px-4">
            Ask the agent to read, refactor, or debug code in this repository.
            Actions are gated by the access level above.
          </div>
        )}
        {live.messages.map((m) => (
          <MessageView
            key={m.id}
            msg={m}
            density={state.logDensity}
            // Only the latest, settled assistant turn can still take answers.
            interactive={!busy && m.id === last?.id && m.role === 'assistant' && !m.streaming}
            onSubmitAnswers={(text) => runTurn(text)}
          />
        ))}
        {pending && (
          <PendingActionCard
            pending={pending}
            onApprove={() => approvalResolver.current?.(true)}
            onDeny={() => approvalResolver.current?.(false)}
          />
        )}
      </div>

      {/* Plan approval affordance */}
      {showApprovePlan && (
        <div className="flex-shrink-0 border-t border-primary/30 bg-primary/5 px-3 py-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Plan ready for review.</span>
          <Button size="xs" onClick={approvePlan}>Approve &amp; execute</Button>
        </div>
      )}

      {/* Composer */}
      <div className="flex-shrink-0 border-t border-border p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            rows={2}
            placeholder={busy ? 'Working…' : 'Message the agent…  (Enter to send)'}
            disabled={busy}
            className="flex-1 resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-60"
          />
          <Button size="sm" onClick={send} loading={busy} disabled={!input.trim()}>Send</Button>
        </div>
      </div>
    </div>
  );
}
