// ─── Model + provider status + pinned rules domain ───────────────────────────

import type { AppAction, AppState } from '../../types';
import { patchContext } from './sessions';

export function providersReducer(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'SET_MODEL':
      return { ...state, currentModel: action.model };

    case 'SET_PROVIDER_STATUS':
      return {
        ...state,
        providerStatus: { ...state.providerStatus, [action.providerId]: action.status },
      };

    case 'SET_SERVED_MODEL':
      return {
        ...state,
        servedModels: { ...state.servedModels, [action.key]: action.model },
      };

    // ── App-global pinned rules CRUD ────────────────────────────────────────

    case 'ADD_PINNED_RULE':
      return { ...state, pinnedRules: [...state.pinnedRules, action.rule] };

    case 'UPDATE_PINNED_RULE':
      return {
        ...state,
        pinnedRules: state.pinnedRules.map((r) =>
          r.id === action.ruleId ? { ...r, ...action.patch } : r,
        ),
      };

    case 'REMOVE_PINNED_RULE':
      return { ...state, pinnedRules: state.pinnedRules.filter((r) => r.id !== action.ruleId) };

    case 'REPLACE_PINNED_RULES':
      return { ...state, pinnedRules: action.rules };

    case 'SYNC_SESSION_RULES_FROM_GLOBAL':
      return patchContext(state, action.sessionId, {
        pinnedRules: state.pinnedRules.map((r) => ({ ...r })),
      });

    default:
      return null;
  }
}
