// ─── Projects domain ─────────────────────────────────────────────────────────

import type { AppAction, AppState } from '../../types';

export function projectsReducer(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'ADD_PROJECT':
      return { ...state, projects: [...state.projects, action.project] };

    case 'RENAME_PROJECT':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id ? { ...p, name: action.name } : p,
        ),
      };

    case 'ARCHIVE_PROJECT':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id ? { ...p, archived: action.archived } : p,
        ),
      };

    case 'REMOVE_PROJECT': {
      // Cascade: drop the project and all its sessions; recompute activeSessionId
      // if it pointed at a removed session (same pattern as CLOSE_SESSION).
      const projects = state.projects.filter((p) => p.id !== action.id);
      const sessions = state.sessions.filter((s) => s.projectId !== action.id);
      const activeStillPresent = state.activeSessionId
        ? sessions.some((s) => s.id === state.activeSessionId)
        : false;
      const activeSessionId = activeStillPresent
        ? state.activeSessionId
        : (sessions[sessions.length - 1]?.id ?? null);
      return { ...state, projects, sessions, activeSessionId };
    }

    default:
      return null;
  }
}
