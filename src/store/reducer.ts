import type { AppAction, AppState, FilterState, LoadState, LogDensity, TabId } from '../types';
import type { PinnedRule, Session, SessionContext } from '../types/session';
import { DEFAULT_PINNED_RULES, createDefaultContext } from '../types/session';
import { buildGraphData } from '../graph/layout';
import { filterCheckpoints } from '../lib/refs';

const PINNED_RULES_STORAGE_KEY = 'code-agent:pinned_rules';
const CURRENT_MODEL_STORAGE_KEY = 'code-agent:current_model';
const SESSIONS_STORAGE_KEY = 'code-agent:sessions';
const ACTIVE_SESSION_STORAGE_KEY = 'code-agent:active_session';
const SHOW_CHECKPOINTS_STORAGE_KEY = 'code-agent:show_checkpoints';
const LOG_DENSITY_STORAGE_KEY = 'code-agent:log_density';

function loadBoolPref(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
}

function loadLogDensity(): LogDensity {
  if (typeof localStorage === 'undefined') return 'verbose';
  try {
    return localStorage.getItem(LOG_DENSITY_STORAGE_KEY) === 'clean' ? 'clean' : 'verbose';
  } catch {
    return 'verbose';
  }
}

/** Cap persisted history so the localStorage blob stays bounded. */
const MAX_PERSISTED_MESSAGES = 100;

// Sessions are persisted so they survive reloads and are reachable from the
// visualizer views. We strip runtime-only fields (live terminals, mid-stream
// flags, transient status) and cap history length before writing.
function stripSessionForStorage(s: Session): Session {
  return {
    ...s,
    terminals: [],
    context: { ...s.context, status: 'idle' },
    messages: s.messages
      .slice(-MAX_PERSISTED_MESSAGES)
      .map((m) => ({ ...m, streaming: false })),
  };
}

function loadSessions(): Session[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Coerce each session's context through defaults so older persisted blobs
    // missing newly-added context fields still load cleanly (schema drift).
    return (parsed as Session[]).map((s) => ({
      ...s,
      terminals: [],
      messages: Array.isArray(s.messages) ? s.messages : [],
      context: { ...createDefaultContext(), ...s.context, status: 'idle' },
    }));
  } catch {
    return [];
  }
}

function loadActiveSessionId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string | null) : null;
  } catch {
    return null;
  }
}

/** Persist only sessions + active id (debounced by the caller). */
export function persistSessions(state: AppState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      SESSIONS_STORAGE_KEY,
      JSON.stringify(state.sessions.map(stripSessionForStorage)),
    );
    localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(state.activeSessionId));
  } catch { /* quota / private mode */ }
}

function loadPinnedRules(): PinnedRule[] {
  if (typeof localStorage === 'undefined') return DEFAULT_PINNED_RULES.map((r) => ({ ...r }));
  try {
    const raw = localStorage.getItem(PINNED_RULES_STORAGE_KEY);
    if (!raw) return DEFAULT_PINNED_RULES.map((r) => ({ ...r }));
    const parsed = JSON.parse(raw) as PinnedRule[];
    if (!Array.isArray(parsed)) return DEFAULT_PINNED_RULES.map((r) => ({ ...r }));
    return parsed;
  } catch {
    return DEFAULT_PINNED_RULES.map((r) => ({ ...r }));
  }
}

function loadCurrentModel(): { providerId: string; modelId: string } {
  if (typeof localStorage === 'undefined') return { providerId: 'anthropic', modelId: 'claude-opus-4-8' };
  try {
    const raw = localStorage.getItem(CURRENT_MODEL_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return { providerId: 'anthropic', modelId: 'claude-opus-4-8' };
}

/** Persist model + pinned rules through a reducer post-tap. */
export function persistState(state: AppState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PINNED_RULES_STORAGE_KEY, JSON.stringify(state.pinnedRules));
    localStorage.setItem(CURRENT_MODEL_STORAGE_KEY, JSON.stringify(state.currentModel));
    localStorage.setItem(SHOW_CHECKPOINTS_STORAGE_KEY, String(state.showCheckpoints));
    localStorage.setItem(LOG_DENSITY_STORAGE_KEY, state.logDensity);
  } catch { /* quota / private mode */ }
}

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
  sessions: loadSessions(),
  activeSessionId: resolveInitialActiveSession(),
  currentModel: loadCurrentModel(),
  providerStatus: {},
  pinnedRules: loadPinnedRules(),
};

// Drop a persisted active id that no longer points at a loaded session.
function resolveInitialActiveSession(): string | null {
  const id = loadActiveSessionId();
  if (!id) return null;
  return loadSessions().some((s) => s.id === id) ? id : null;
}

// Immutably update one session's fields by id.
function mapSession(state: AppState, id: string, fn: (s: Session) => Session): AppState {
  return { ...state, sessions: state.sessions.map((s) => (s.id === id ? fn(s) : s)) };
}

// Immutably patch one session's context by id.
function patchContext(state: AppState, id: string, patch: Partial<SessionContext>): AppState {
  return mapSession(state, id, (s) => ({ ...s, context: { ...s.context, ...patch } }));
}

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

    case 'SET_SHOW_CHECKPOINTS': {
      if (!state.graphData) return { ...state, showCheckpoints: action.show };
      const displayCommits = filterCheckpoints(state.rawCommits, action.show);
      const graphData = buildGraphData(displayCommits, state.branches, state.tags);
      return {
        ...state,
        showCheckpoints: action.show,
        allCommits: displayCommits,
        graphData,
        selectedNode: null,
        selectedNodes: [],
      };
    }

    case 'SET_LOG_DENSITY':
      return { ...state, logDensity: action.density };

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

    // ── Agent sessions ──────────────────────────────────────────────────────

    case 'CREATE_SESSION': {
      // Seed the new session's pinned rules from the app-global set so users
      // don't have to redo their CRUD per session.
      const seeded: Session = {
        ...action.session,
        context: {
          ...action.session.context,
          pinnedRules: state.pinnedRules.map((r) => ({ ...r })),
        },
      };
      return {
        ...state,
        sessions: [...state.sessions, seeded],
        activeSessionId: seeded.id,
      };
    }

    case 'SET_ACTIVE_SESSION':
      return { ...state, activeSessionId: action.id };

    case 'CLOSE_SESSION': {
      const sessions = state.sessions.filter((s) => s.id !== action.id);
      const activeSessionId =
        state.activeSessionId === action.id
          ? (sessions[sessions.length - 1]?.id ?? null)
          : state.activeSessionId;
      return { ...state, sessions, activeSessionId };
    }

    case 'SET_ACCESS_LEVEL':
      return patchContext(state, action.sessionId, { accessLevel: action.level });

    case 'SET_BUILD_MODE':
      return patchContext(state, action.sessionId, { buildMode: action.mode });

    case 'SET_REASONING_BUDGET':
      return patchContext(state, action.sessionId, { reasoningBudget: action.budget });

    case 'TOGGLE_SKILL':
      return mapSession(state, action.sessionId, (s) => ({
        ...s,
        context: {
          ...s.context,
          skills: s.context.skills.map((sk) =>
            sk.id === action.skillId ? { ...sk, enabled: !sk.enabled } : sk,
          ),
        },
      }));

    case 'PATCH_SESSION_CONTEXT':
      return patchContext(state, action.sessionId, action.patch);

    case 'SET_SESSION_STATUS':
      return patchContext(state, action.sessionId, { status: action.status });

    case 'UPDATE_CONTEXT_TOKENS':
      return mapSession(state, action.sessionId, (s) => ({
        ...s,
        context: {
          ...s.context,
          contextTokens: {
            used: action.used,
            max: action.max ?? s.context.contextTokens.max,
          },
        },
      }));

    case 'SET_SESSION_GIT':
      return patchContext(state, action.sessionId, {
        gitBranch: action.branch,
        gitStatusSummary: action.statusSummary,
      });

    case 'ADD_AGENT_MESSAGE':
      return mapSession(state, action.sessionId, (s) => ({
        ...s,
        messages: [...s.messages, action.message],
      }));

    case 'UPDATE_AGENT_MESSAGE':
      return mapSession(state, action.sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === action.messageId ? { ...m, ...action.patch } : m,
        ),
      }));

    // ── Model + provider status ─────────────────────────────────────────────

    case 'SET_MODEL':
      return { ...state, currentModel: action.model };

    case 'SET_PROVIDER_STATUS':
      return {
        ...state,
        providerStatus: { ...state.providerStatus, [action.providerId]: action.status },
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
      return state;
  }
}
