// ─── Graph / repo-load domain ────────────────────────────────────────────────
// Repo loading lifecycle, node selection, filters, viewport, and the
// checkpoint toggle. The expensive graph rebuild for the toggle happens
// OUTSIDE the reducer (src/hooks/useShowCheckpoints.ts) and lands here via
// SET_GRAPH_DATA — dispatch must stay cheap.

import type { AppAction, AppState, TabId } from '../../types';
import { initialFilterState, initialState } from '../reducer';

export function graphReducer(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case 'LOAD_START':
      return {
        ...state,
        repoInfo: null,
        graphData: null,
        branches: [],
        tags: [],
        allCommits: [],
        rawCommits: [],
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
        // Keep the full commit set so the checkpoint toggle can rebuild without
        // a refetch. Falls back to the displayed set when the loader didn't
        // pass a raw list (e.g. cached swap-ins).
        rawCommits: action.rawCommits ?? action.allCommits,
        loadState: { phase: 'done', message: '', progress: 100 },
      };

    case 'SET_SHOW_CHECKPOINTS':
      // Flag only. useShowCheckpoints rebuilds the graph off the render path
      // and swaps it in via SET_GRAPH_DATA.
      return { ...state, showCheckpoints: action.show };

    case 'SET_GRAPH_DATA':
      return {
        ...state,
        graphData: action.graphData,
        allCommits: action.allCommits,
        selectedNode: null,
        selectedNodes: [],
      };

    case 'LOAD_ERROR':
      return {
        ...state,
        loadState: { phase: 'error', message: action.message, progress: 0, error: action.message },
      };

    case 'RESET':
      return { ...initialState, token: state.token, source: state.source };

    case 'SET_SOURCE':
      return {
        ...state,
        source: action.source,
        localPath: action.localPath !== undefined ? action.localPath : state.localPath,
      };

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

    case 'SCROLL_TO_SHA':
      return { ...state, panToSha: action.sha };

    case 'SET_GRAPH_DIRECTION':
      return { ...state, graphDirection: action.direction };

    case 'SET_PANE_TAB': {
      const paneTab = [...state.paneTab] as [TabId, TabId, TabId, TabId];
      paneTab[action.pane] = action.tab;
      return { ...state, paneTab };
    }

    default:
      return null;
  }
}
