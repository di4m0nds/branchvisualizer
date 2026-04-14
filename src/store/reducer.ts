import type { AppAction, AppState, FilterState, LoadState } from '../types';

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
  hoveredNode: null,
  filter: initialFilterState,
  viewport: { offsetX: 0, offsetY: 0, scale: 1 },
  token: '',
  rateLimit: null,
};

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_TOKEN':
      return { ...state, token: action.token };

    case 'LOAD_START':
      return {
        ...state,
        repoInfo: null,
        graphData: null,
        branches: [],
        tags: [],
        allCommits: [],
        selectedNode: null,
        hoveredNode: null,
        loadState: { phase: 'fetching-repo', message: 'Starting…', progress: 0 },
        filter: initialFilterState,
        viewport: { offsetX: 16, offsetY: 16, scale: 1 },
      };

    case 'SET_LOAD_STATE':
      return {
        ...state,
        loadState: { ...state.loadState, ...action.state },
      };

    case 'LOAD_SUCCESS':
      return {
        ...state,
        repoInfo: action.repoInfo,
        graphData: action.graphData,
        branches: action.branches,
        tags: action.tags,
        allCommits: action.allCommits,
        loadState: { phase: 'done', message: '', progress: 100 },
      };

    case 'LOAD_ERROR':
      return {
        ...state,
        loadState: { phase: 'error', message: action.message, progress: 0, error: action.message },
      };

    case 'RESET':
      return { ...initialState, token: state.token };

    case 'SELECT_NODE':
      return { ...state, selectedNode: action.node };

    case 'HOVER_NODE':
      return { ...state, hoveredNode: action.node };

    case 'SET_FILTER':
      return { ...state, filter: { ...state.filter, ...action.filter }, selectedNode: null };

    case 'SET_VIEWPORT':
      return { ...state, viewport: { ...state.viewport, ...action.viewport } };

    case 'SET_RATE_LIMIT':
      return { ...state, rateLimit: action.rateLimit };

    default:
      return state;
  }
}
