// ─── Root reducer: composition point ─────────────────────────────────────────
// State transitions live in domain reducers under ./reducers/ (graph, ui,
// projects, sessions, providers); persistence/boot loading in
// ./reducers/persistence.ts. Each domain reducer returns null for foreign
// actions; the root tries them in order. Exactly one domain owns each action.

import type { AppAction, AppState, FilterState, LoadState } from '../types';
import {
  CHAT_FONT_STORAGE_KEY,
  SHOW_CHECKPOINTS_STORAGE_KEY,
  TERMINAL_FONT_STORAGE_KEY,
  bootstrapProjectsAndSessions,
  loadBoolPref,
  loadChatBackground,
  loadCurrentModel,
  loadFontPref,
  loadLogDensity,
  loadPinnedRules,
} from './reducers/persistence';
import { graphReducer } from './reducers/graph';
import { uiReducer } from './reducers/ui';
import { projectsReducer } from './reducers/projects';
import { sessionsReducer } from './reducers/sessions';
import { providersReducer } from './reducers/providers';

// Persistence taps consumed by AppContext — re-exported so the store wiring
// has a single import point.
export { persistSessions, persistState } from './reducers/persistence';

export const initialFilterState: FilterState = {
  search: '',
  branch: '',
  author: '',
  dateFrom: '',
  dateTo: '',
};

export const initialLoadState: LoadState = {
  phase: 'idle',
  message: '',
  progress: 0,
};

export const initialState: AppState = {
  repoInfo: null,
  graphData: null,
  branches: [],
  tags: [],
  allCommits: [],
  loadState: initialLoadState,
  selectedNode: null,
  selectedNodes: [],
  hoveredNode: null,
  filter: initialFilterState,
  viewport: { offsetX: 0, offsetY: 0, scale: 1 },
  token: '',
  rateLimit: null,
  viewMode: 'canvas',
  theme: 'dark',
  panToSha: null,
  activeTab: 'graph',
  splitLayout: 'single',
  paneTab: ['graph', 'list', 'releases', 'prs'],
  graphDirection: 'vertical',
  source: 'github',
  localPath: null,
  rawCommits: [],
  showCheckpoints: loadBoolPref(SHOW_CHECKPOINTS_STORAGE_KEY, false),
  logDensity: loadLogDensity(),
  terminalFont: loadFontPref(TERMINAL_FONT_STORAGE_KEY),
  chatFont: loadFontPref(CHAT_FONT_STORAGE_KEY),
  chatBackground: loadChatBackground(),
  ...bootstrapProjectsAndSessions(),
  currentModel: loadCurrentModel(),
  providerStatus: {},
  servedModels: {},
  pinnedRules: loadPinnedRules(),
};

const DOMAIN_REDUCERS = [
  graphReducer,
  uiReducer,
  projectsReducer,
  sessionsReducer,
  providersReducer,
] as const;

export function reducer(state: AppState, action: AppAction): AppState {
  for (const domain of DOMAIN_REDUCERS) {
    const next = domain(state, action);
    if (next !== null) return next;
  }
  return state;
}
