// ─── Domain types (re-exported from @codeatlas/core) ──────────────────────────
//
// RepoInfo, Commit, Branch, Tag, GraphNode, GraphEdge, GraphData, RateLimit,
// CommitAuthor, CommitStats — source of truth is packages/core/src/types.ts.
// Re-exported here so all existing app imports resolve unchanged.

export type {
  RepoInfo,
  CommitAuthor,
  CommitStats,
  Commit,
  Branch,
  Tag,
  GraphNode,
  GraphEdge,
  GraphData,
  RateLimit,
} from '@codeatlas/core';

// ─── App-specific UI types ─────────────────────────────────────────────────
//
// These types are specific to the branchvisualizer app (React state, actions,
// routing) and do NOT belong in @codeatlas/core.

export type TabId = 'graph' | 'list' | 'files' | 'readme' | 'prs' | 'releases' | 'ci' | 'hotspots';
export type Capability = 'read:graph' | 'read:files' | 'compare:commits' | 'ai:assist';

export interface CapabilityState {
  capabilities: Capability[];
  authenticated: boolean;
  login: string | null;
  backendTokenConfigured: boolean;
  loading: boolean;
}
export type SplitLayout = 'single' | '2h' | '2v' | '4g';
export type GraphDirection = 'vertical' | 'horizontal';
export type ViewMode = 'canvas' | 'list';
export type Theme = 'dark' | 'light';

// ─── App state ─────────────────────────────────────────────────────────────

export type LoadPhase =
  | 'idle'
  | 'validating'
  | 'fetching-repo'
  | 'fetching-branches'
  | 'fetching-commits'
  | 'building-graph'
  | 'done'
  | 'error';

export interface LoadState {
  phase: LoadPhase;
  message: string;
  progress: number; // 0-100
  error?: string;
}

export interface FilterState {
  search: string;
  branch: string;    // '' = all branches
  author: string;    // '' = all authors
  dateFrom: string;  // ISO date string, '' = no filter
  dateTo: string;
}

export interface ViewportState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

// Re-import domain types needed by AppState to avoid duplication
import type {
  RepoInfo,
  GraphData,
  Branch,
  Tag,
  Commit,
  GraphNode,
  RateLimit,
} from '@codeatlas/core';

export interface AppState {
  repoInfo: RepoInfo | null;
  graphData: GraphData | null;
  branches: Branch[];
  tags: Tag[];
  allCommits: Commit[];
  loadState: LoadState;
  selectedNode: GraphNode | null;
  selectedNodes: GraphNode[];
  hoveredNode: GraphNode | null;
  filter: FilterState;
  viewport: ViewportState;
  token: string;
  rateLimit: RateLimit | null;
  viewMode: ViewMode;
  theme: Theme;
  /** SHA to smoothly pan the graph canvas to. Cleared after animation starts. */
  panToSha: string | null;
  /** Active tab in the tab workspace */
  activeTab: TabId;
  /** Split layout mode */
  splitLayout: SplitLayout;
  /** Active tab for each pane slot (0=main/TL, 1=TR/bottom, 2=BL, 3=BR) */
  paneTab: [TabId, TabId, TabId, TabId];
  /** Graph layout direction */
  graphDirection: GraphDirection;
  /** Resolved capabilities (auth state) */
  capabilityState: CapabilityState;
}

// ─── Action types ──────────────────────────────────────────────────────────

export type AppAction =
  | { type: 'SET_TOKEN'; token: string }
  | { type: 'LOAD_START' }
  | { type: 'SET_LOAD_STATE'; state: Partial<LoadState> }
  | { type: 'LOAD_SUCCESS'; repoInfo: RepoInfo; graphData: GraphData; branches: Branch[]; tags: Tag[]; allCommits: Commit[] }
  | { type: 'LOAD_ERROR'; message: string }
  | { type: 'RESET' }
  | { type: 'SELECT_NODE'; node: GraphNode | null }
  | { type: 'TOGGLE_MULTI_SELECT'; node: GraphNode }
  | { type: 'HOVER_NODE'; node: GraphNode | null }
  | { type: 'SET_FILTER'; filter: Partial<FilterState> }
  | { type: 'SET_VIEWPORT'; viewport: Partial<ViewportState> }
  | { type: 'SET_RATE_LIMIT'; rateLimit: RateLimit }
  | { type: 'SET_VIEW_MODE'; viewMode: ViewMode }
  | { type: 'SET_THEME'; theme: Theme }
  | { type: 'SCROLL_TO_SHA'; sha: string | null }
  | { type: 'SET_ACTIVE_TAB'; tab: TabId }
  | { type: 'SET_SPLIT_LAYOUT'; layout: SplitLayout }
  | { type: 'SET_PANE_TAB'; pane: 0 | 1 | 2 | 3; tab: TabId }
  | { type: 'SET_GRAPH_DIRECTION'; direction: GraphDirection }
  | { type: 'SET_CAPABILITIES'; payload: CapabilityState };
