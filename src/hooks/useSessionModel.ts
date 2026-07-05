// ─── Session-scoped model selection ──────────────────────────────────────────
// With per-session model config, the IDE chrome's model pickers operate on the
// ACTIVE SESSION's selection: picking a model changes only that session. When
// no session is active (or in the plain repo view) they fall back to the
// app-global default, which seeds new sessions.

import { useAppDispatch, useAppSelector } from '@/store/store';
import type { ModelRef } from '@/types';

export function useSessionModel(scope: 'auto' | 'global' = 'auto'): {
  selected: ModelRef;
  setModel: (model: ModelRef) => void;
  /** True when the selection is bound to the active session (vs the global default). */
  isSessionScoped: boolean;
} {
  const dispatch = useAppDispatch();
  const activeId = useAppSelector((s) => s.activeSessionId);
  // 'global' pins the hook to the app default (Settings surfaces) even while a
  // session is active.
  const activeSessionId = scope === 'global' ? null : activeId;
  // Returns an existing object reference (sessions are only recreated when
  // touched), so the Object.is selector contract holds.
  const sessionModel = useAppSelector(
    (s) => s.sessions.find((x) => x.id === s.activeSessionId)?.modelConfig?.model ?? null,
  );
  const globalModel = useAppSelector((s) => s.currentModel);

  const isSessionScoped = activeSessionId !== null;
  const selected = isSessionScoped ? (sessionModel ?? globalModel) : globalModel;

  const setModel = (model: ModelRef) => {
    if (activeSessionId) {
      dispatch({ type: 'SET_SESSION_MODEL', sessionId: activeSessionId, model });
    } else {
      dispatch({ type: 'SET_MODEL', model });
    }
  };

  return { selected, setModel, isSessionScoped };
}
