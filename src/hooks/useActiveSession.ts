import { useAppContext } from '@/store/AppContext';
import type { Session } from '@/types/session';

/**
 * Returns the currently active agent session (or null). The single accessor for
 * "the session in focus" — future work can migrate repo/graph/terminal state to
 * be owned per-session behind this selector without touching call sites.
 */
export function useActiveSession(): Session | null {
  const { state } = useAppContext();
  return state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
}
