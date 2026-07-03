import { useAppSelector } from '@/store/store';
import type { Session } from '@/types/session';

/**
 * Returns the currently active agent session (or null). The single accessor for
 * "the session in focus" — future work can migrate repo/graph/terminal state to
 * be owned per-session behind this selector without touching call sites.
 * Subscribes only to the active session object (not the whole store), so
 * consumers re-render when it changes and nothing else.
 */
export function useActiveSession(): Session | null {
  return useAppSelector((s) => s.sessions.find((x) => x.id === s.activeSessionId) ?? null);
}
