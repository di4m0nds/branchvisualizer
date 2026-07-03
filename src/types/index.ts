import type {
  AccessLevel, BuildMode, PinnedRule, PlanComment, Project, ReasoningBudget, Session, SessionContext, SessionStatus, AgentMessage,
} from './session';
import type { ContextSizeId, ProbeResult } from '@/lib/agent/transport';

export interface ModelRef {
  providerId: string;
  modelId: string;
  /** Selected context-window variant. Undefined ⇒ 'standard'. */
  context?: ContextSizeId;
}

// ─── Repository & API types ────────────────────────────────────────────────

export interface RepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  description: string | null;
  homepage: string | null;
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

export type TabId = 'graph' | 'list' | 'files' | 'readme' | 'docs' | 'prs' | 'releases' | 'ci';
export type RepoSource = 'github' | 'local';
export type SplitLayout = 'single' | '2h' | '2v' | '4g';
export type GraphDirection = 'vertical' | 'horizontal';
export type ViewMode = 'canvas' | 'list';
export type Theme = 'dark' | 'light';
export type LogDensity = 'verbose' | 'clean';

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
  /** Data source for the current repo view */
  source: RepoSource;
  /** Absolute path to the local repo when source === 'local' */
  localPath: string | null;
  /** Full, unfiltered commit list (source of truth for checkpoint toggling). */
  rawCommits: Commit[];
  /** Whether t3 checkpoint commits are shown in the graph. Default false. */
  showCheckpoints: boolean;
  /** Agent-log verbosity for the chat transcript. */
  logDensity: LogDensity;
  /** User-picked terminal/nvim font family (null = system default stack). */
  terminalFont: string | null;
  /** Registered projects — each groups its own set of sessions/threads. */
  projects: Project[];
  /** Agent sessions (IDE mode). Additive — does not affect the flat repo view. */
  sessions: Session[];
  activeSessionId: string | null;
  /** Currently selected model — provider + model id. */
  currentModel: ModelRef;
  /** Cached probe result per provider id. */
  providerStatus: Record<string, ProbeResult>;
  /** Model the provider actually served, keyed by `${providerId}:${modelId}`.
   *  Runtime-only (not persisted) — lets the chip show what really ran vs what
   *  was requested (e.g. a `sonnet` alias resolving to a concrete version). */
  servedModels: Record<string, string>;
  /** App-global pinned rules. Seeds new sessions; edited via the rules editor. */
  pinnedRules: PinnedRule[];
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
  | { type: 'LOAD_SUCCESS'; repoInfo: RepoInfo; graphData: GraphData; branches: Branch[]; tags: Tag[]; allCommits: Commit[]; rawCommits?: Commit[] }
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
  | { type: 'SET_SHOW_CHECKPOINTS'; show: boolean }
  | { type: 'SET_LOG_DENSITY'; density: LogDensity }
  | { type: 'SET_TERMINAL_FONT'; family: string | null }
  | { type: 'SET_SOURCE'; source: RepoSource; localPath?: string | null }
  // ── Projects ──
  | { type: 'ADD_PROJECT'; project: Project }
  | { type: 'RENAME_PROJECT'; id: string; name: string }
  | { type: 'ARCHIVE_PROJECT'; id: string; archived: boolean }
  | { type: 'REMOVE_PROJECT'; id: string }
  // ── Agent sessions ──
  | { type: 'CREATE_SESSION'; session: Session }
  | { type: 'SET_ACTIVE_SESSION'; id: string }
  | { type: 'CLOSE_SESSION'; id: string }
  | { type: 'ARCHIVE_SESSION'; id: string; archived: boolean }
  | { type: 'RENAME_SESSION'; id: string; title: string }
  | { type: 'SET_ACCESS_LEVEL'; sessionId: string; level: AccessLevel }
  | { type: 'SET_BUILD_MODE'; sessionId: string; mode: BuildMode }
  | { type: 'SET_REASONING_BUDGET'; sessionId: string; budget: ReasoningBudget }
  | { type: 'TOGGLE_SKILL'; sessionId: string; skillId: string }
  | { type: 'PATCH_SESSION_CONTEXT'; sessionId: string; patch: Partial<SessionContext> }
  | { type: 'SET_SESSION_STATUS'; sessionId: string; status: SessionStatus }
  | { type: 'UPDATE_CONTEXT_TOKENS'; sessionId: string; used: number; max?: number }
  | { type: 'SET_SESSION_GIT'; sessionId: string; branch: string | null; statusSummary: string | null }
  | { type: 'ADD_AGENT_MESSAGE'; sessionId: string; message: AgentMessage }
  | { type: 'UPDATE_AGENT_MESSAGE'; sessionId: string; messageId: string; patch: Partial<AgentMessage> }
  /** Drop the message identified by `beforeMessageId` AND every message after
   *  it. Used by the "revert conversation to this point" affordance so a user
   *  can edit and re-send an earlier turn without accumulating dead history. */
  | { type: 'TRUNCATE_MESSAGES_BEFORE'; sessionId: string; beforeMessageId: string }
  /** Flip the session's Claude Code CLI bypass flag. Set true when the user
   *  approves the `cli_approval_needed` card so subsequent turns pass
   *  `--permission-mode bypassPermissions`. */
  | { type: 'SET_SESSION_CLI_BYPASS'; sessionId: string; bypass: boolean }
  // ── Plan view (annotations + in-place edits) ──
  | { type: 'ADD_PLAN_COMMENT'; sessionId: string; comment: PlanComment }
  | { type: 'UPDATE_PLAN_COMMENT'; sessionId: string; commentId: string; patch: Partial<PlanComment> }
  | { type: 'REMOVE_PLAN_COMMENT'; sessionId: string; commentId: string }
  | { type: 'SET_PLAN_DRAFT'; sessionId: string; draft: Session['planDraft'] }
  // ── Model + provider status ──
  | { type: 'SET_MODEL'; model: ModelRef }
  | { type: 'SET_PROVIDER_STATUS'; providerId: string; status: ProbeResult }
  | { type: 'SET_SERVED_MODEL'; key: string; model: string }
  // ── Pinned rules (app-global CRUD) ──
  | { type: 'ADD_PINNED_RULE'; rule: PinnedRule }
  | { type: 'UPDATE_PINNED_RULE'; ruleId: string; patch: Partial<PinnedRule> }
  | { type: 'REMOVE_PINNED_RULE'; ruleId: string }
  | { type: 'REPLACE_PINNED_RULES'; rules: PinnedRule[] }
  | { type: 'SYNC_SESSION_RULES_FROM_GLOBAL'; sessionId: string };
