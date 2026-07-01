import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAppContext } from '@/store/AppContext';
import { nextId, type PinnedRule } from '@/types/session';

// App-global pinned-rules CRUD. New sessions inherit whatever's here at creation
// time; existing sessions carry their own copy so mid-session mutations don't
// silently change enforcement (the "Sync from global" button on a session
// forces a re-seed). Persisted to localStorage in the reducer post-tap.

function validateRegex(pattern: string): string | null {
  if (!pattern) return null;
  try { new RegExp(pattern); return null; } catch (e) { return e instanceof Error ? e.message : 'invalid regex'; }
}

interface RowProps {
  rule: PinnedRule;
  onChange: (patch: Partial<PinnedRule>) => void;
  onDelete: () => void;
}

function RuleRow({ rule, onChange, onDelete }: RowProps) {
  const pattern = rule.block?.pattern ?? '';
  const tools = rule.block?.tools?.join(', ') ?? '';
  const regexErr = useMemo(() => validateRegex(pattern), [pattern]);

  return (
    <div className="border border-border rounded-md p-2 space-y-2 bg-muted/10">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-muted-foreground/60">{rule.id}</span>
        <button
          onClick={onDelete}
          className="ml-auto text-[10px] font-mono text-muted-foreground hover:text-destructive"
        >
          delete
        </button>
      </div>
      <textarea
        value={rule.text}
        onChange={(e) => onChange({ text: e.target.value })}
        rows={2}
        className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs"
        placeholder="Rule text (shown to the model each turn)"
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Tools</label>
          <input
            value={tools}
            onChange={(e) => {
              const list = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
              onChange({ block: { tools: list, pattern: pattern } });
            }}
            placeholder="run_command, git_commit"
            className="w-full h-7 rounded border border-border bg-background px-2 text-xs font-mono"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Pattern (regex)</label>
          <input
            value={pattern}
            onChange={(e) => onChange({ block: { tools: rule.block?.tools ?? [], pattern: e.target.value } })}
            placeholder="git\\s+(commit|push)"
            className={cn(
              'w-full h-7 rounded border bg-background px-2 text-xs font-mono',
              regexErr ? 'border-destructive/60' : 'border-border',
            )}
          />
          {regexErr && <span className="text-[10px] text-destructive">{regexErr}</span>}
        </div>
      </div>
    </div>
  );
}

export default function PinnedRulesEditor({
  open, onClose, sessionId,
}: {
  open: boolean;
  onClose: () => void;
  sessionId?: string;
}) {
  const { state, dispatch } = useAppContext();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[95vw] max-h-[85vh] flex flex-col rounded-lg border border-border bg-popover shadow-xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <div className="text-sm font-semibold">Pinned rules</div>
            <div className="text-[10px] text-muted-foreground">
              Applied to every turn. Kept even when new sessions are created.
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {state.pinnedRules.length === 0 && (
            <p className="text-xs text-muted-foreground/60 text-center py-6">
              No pinned rules. Add one — for example: "Do not commit or push anything."
            </p>
          )}
          {state.pinnedRules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onChange={(patch) => dispatch({ type: 'UPDATE_PINNED_RULE', ruleId: rule.id, patch })}
              onDelete={() => dispatch({ type: 'REMOVE_PINNED_RULE', ruleId: rule.id })}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
          <Button
            size="sm"
            variant="outline"
            onClick={() => dispatch({
              type: 'ADD_PINNED_RULE',
              rule: { id: nextId('rule'), text: '', block: { tools: [], pattern: '' } },
            })}
          >
            + Add rule
          </Button>
          {sessionId && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dispatch({ type: 'SYNC_SESSION_RULES_FROM_GLOBAL', sessionId })}
              title="Overwrite this session's rules with the global set"
            >
              Sync current session
            </Button>
          )}
          <div className="flex-1" />
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

// Locally used so the Editor typechecks; PinnedRule is re-exported for clarity.
export type { PinnedRule };
