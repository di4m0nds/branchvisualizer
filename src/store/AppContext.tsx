import { useEffect, type ReactNode } from 'react';
import { getAppState, useAppSelector } from './store';
import { persistSessions, persistState } from './reducer';

// Re-export so the store swap is invisible to the ~40 existing call sites.
// New/hot components should import `useAppSelector` from '@/store/store'.
// eslint-disable-next-line react-refresh/only-export-components -- intentional back-compat re-export; hooks live in store.ts
export { useAppContext, useAppDispatch, useAppSelector, getAppState } from './store';

/**
 * No longer a context provider — state lives in the external store (see
 * ./store.ts). This component only hosts the persistence effects, driven by
 * selectors of exactly the keys each write watches.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  // Persist model choice + pinned rules + UI prefs on change (cheap; localStorage).
  const currentModel = useAppSelector((s) => s.currentModel);
  const pinnedRules = useAppSelector((s) => s.pinnedRules);
  const showCheckpoints = useAppSelector((s) => s.showCheckpoints);
  const logDensity = useAppSelector((s) => s.logDensity);
  const terminalFont = useAppSelector((s) => s.terminalFont);
  const chatFont = useAppSelector((s) => s.chatFont);
  const chatBackground = useAppSelector((s) => s.chatBackground);
  useEffect(() => {
    persistState(getAppState());
  }, [currentModel, pinnedRules, showCheckpoints, logDensity, terminalFont, chatFont, chatBackground]);

  // Persist sessions separately and debounced: the sessions array gets a new
  // identity on every streamed token, so writing synchronously would thrash
  // localStorage during agent turns.
  const sessions = useAppSelector((s) => s.sessions);
  const activeSessionId = useAppSelector((s) => s.activeSessionId);
  useEffect(() => {
    const t = setTimeout(() => persistSessions(getAppState()), 400);
    return () => clearTimeout(t);
  }, [sessions, activeSessionId]);

  return <>{children}</>;
}
