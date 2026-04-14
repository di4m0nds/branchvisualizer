// ─── Repository & API types ────────────────────────────────────────────────

export interface RepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  description: string | null;
  starCount: number;
  forkCount: number;
  isPrivate: boolean;
  url: string;
  pushedAt: string | null;
}

export interface CommitAuthor {
  name: string;
  email: string;
  date: string; // ISO 8601
  login?: string;
  avatarUrl?: string;
}

export interface Commit {
  sha: string;
  shortSha: string;
  message: string;
  subject: string;   // first line of message
  body: string;      // rest of message
  author: CommitAuthor;
  committer: CommitAuthor;
  parents: string[]; // parent SHAs
  isMerge: boolean;
  stats?: CommitStats;
}

export interface CommitStats {
  additions: number;
  deletions: number;
  total: number;
}

export interface Branch {
  name: string;
  sha: string;       // tip commit sha
  isDefault: boolean;
  isRemote: boolean;
}

export interface Tag {
  name: string;
  sha: string;       // tagged commit sha (or tag object sha)
  commitSha: string; // resolved commit sha
  message?: string;
}

// ─── Graph types ───────────────────────────────────────────────────────────

export interface GraphNode {
  commit: Commit;
  lane: number;      // x column index (0 = leftmost)
  row: number;       // y row index (0 = newest)
  color: string;     // primary color for this lane
  x: number;        // canvas x (computed from lane)
  y: number;        // canvas y (computed from row)
}

export interface GraphEdge {
  fromSha: string;
  toSha: string;     // parent sha
  fromLane: number;
  toLane: number;
  fromRow: number;
  toRow: number;
  color: string;
  isMergeEdge: boolean;  // true when connecting to a secondary parent
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  commitMap: Map<string, GraphNode>;  // sha -> node
  tagMap: Map<string, Tag[]>;         // commitSha -> tags
  branchMap: Map<string, Branch[]>;   // commitSha -> branches
  laneCount: number;
  rowCount: number;
}

// ─── UI state ──────────────────────────────────────────────────────────────

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

export interface AppState {
  repoInfo: RepoInfo | null;
  graphData: GraphData | null;
  branches: Branch[];
  tags: Tag[];
  allCommits: Commit[];
  loadState: LoadState;
  selectedNode: GraphNode | null;
  hoveredNode: GraphNode | null;
  filter: FilterState;
  viewport: ViewportState;
  token: string;
  rateLimit: RateLimit | null;
  viewMode: ViewMode;
  theme: Theme;
}

export interface RateLimit {
  remaining: number;
  limit: number;
  resetAt: Date;
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
  | { type: 'HOVER_NODE'; node: GraphNode | null }
  | { type: 'SET_FILTER'; filter: Partial<FilterState> }
  | { type: 'SET_VIEWPORT'; viewport: Partial<ViewportState> }
  | { type: 'SET_RATE_LIMIT'; rateLimit: RateLimit }
  | { type: 'SET_VIEW_MODE'; viewMode: ViewMode }
  | { type: 'SET_THEME'; theme: Theme };
