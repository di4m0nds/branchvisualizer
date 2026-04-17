import type { AppAction, AppState, CapabilityState, FilterState, LoadState, TabId } from '../types';

export const initialFilterState: FilterState = {
  search: '',
  branch: '',
  author: '',
  dateFrom: '',
  dateTo: '',
};

export const initialCapabilityState: CapabilityState = {
  capabilities: ['read:graph'],
  authenticated: false,
  login: null,
  backendTokenConfigured: false,
  loading: false,
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
  capabilityState: initialCapabilityState,
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
        selectedNodes: [],
        hoveredNode: null,
        loadState: { phase: 'fetching-repo', message: 'Starting...', progress: 0 },
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
      return { ...initialState, token: state.token, capabilityState: state.capabilityState };

    case 'SELECT_NODE':
      return {
        ...state,
        selectedNode: action.node,
        selectedNodes: action.node ? [action.node] : [],
      };

    case 'TOGGLE_MULTI_SELECT': {
      const idx = state.selectedNodes.findIndex(n => n.commit.sha === action.node.commit.sha);
      if (idx >= 0) {
        // Remove from selection
        const newNodes = state.selectedNodes.filter(n => n.commit.sha !== action.node.commit.sha);
        return {
          ...state,
          selectedNodes: newNodes,
          selectedNode: newNodes.length > 0 ? newNodes[newNodes.length - 1] : null,
        };
      } else {
        // Add to selection
        const newNodes = [...state.selectedNodes, action.node];
        return {
          ...state,
          selectedNodes: newNodes,
          selectedNode: action.node,
        };
      }
    }

    case 'HOVER_NODE':
      return { ...state, hoveredNode: action.node };

    case 'SET_FILTER':
      return { ...state, filter: { ...state.filter, ...action.filter }, selectedNode: null, selectedNodes: [] };

    case 'SET_VIEWPORT':
      return { ...state, viewport: { ...state.viewport, ...action.viewport } };

    case 'SET_RATE_LIMIT':
      return { ...state, rateLimit: action.rateLimit };

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.viewMode, selectedNode: null, selectedNodes: [] };

    case 'SET_THEME':
      return { ...state, theme: action.theme };

    case 'SCROLL_TO_SHA':
      return { ...state, panToSha: action.sha };

    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.tab };

    case 'SET_SPLIT_LAYOUT':
      return { ...state, splitLayout: action.layout };

    case 'SET_PANE_TAB': {
      const paneTab = [...state.paneTab] as [TabId, TabId, TabId, TabId];
      paneTab[action.pane] = action.tab;
      return { ...state, paneTab };
    }

    case 'SET_GRAPH_DIRECTION':
      return { ...state, graphDirection: action.direction };

    case 'SET_CAPABILITIES':
      return { ...state, capabilityState: action.payload };

    default:
      return state;
  }
}
