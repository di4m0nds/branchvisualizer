// ─── UI / prefs domain ───────────────────────────────────────────────────────
// Theme, tabs, layout, fonts, density, auth token, rate limit.

import type { AppAction, AppState } from '../../types';

export function uiReducer(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'SET_TOKEN':
      return { ...state, token: action.token };

    case 'SET_RATE_LIMIT':
      return { ...state, rateLimit: action.rateLimit };

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.viewMode, selectedNode: null, selectedNodes: [] };

    case 'SET_THEME':
      return { ...state, theme: action.theme };

    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.tab };

    case 'SET_SPLIT_LAYOUT':
      return { ...state, splitLayout: action.layout };

    case 'SET_LOG_DENSITY':
      return { ...state, logDensity: action.density };

    case 'SET_TERMINAL_FONT':
      return { ...state, terminalFont: action.family };

    case 'SET_CHAT_FONT':
      return { ...state, chatFont: action.family };

    case 'SET_CHAT_BACKGROUND':
      return { ...state, chatBackground: action.texture };

    default:
      return null;
  }
}
