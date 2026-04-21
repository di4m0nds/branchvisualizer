// apps/branchvisualizer/src/store/assistantStore.tsx
// Assistant session store — shared sessions list, local active selection.
//
// Design: sessions[] lives in global context so all panes see the same list.
// activeSessionId is intentionally NOT stored here — each AssistantTab instance
// holds its own useState so split-pane views can independently select sessions.

import { createContext, useContext, useReducer, type ReactNode, type Dispatch, useEffect } from 'react';
import type { AIProviderId } from '@codeatlas/ai';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionMode = 'chat' | 'pr' | 'review';
export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageContext {
  sha?: string;
  commitSubject?: string;
  additions?: number;
  deletions?: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface AssistantMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  context?: MessageContext;
  streaming?: boolean;
  tokenUsage?: TokenUsage;
}

export interface AssistantSessionConfig {
  provider: AIProviderId;
  model: string;
  /** User-supplied API key — NOT persisted to localStorage */
  apiKey?: string;
  useProxy: boolean;
}

export interface AssistantSession {
  id: string;
  title: string;
  mode: SessionMode;
  config: AssistantSessionConfig;
  messages: AssistantMessage[];
  createdAt: string;
  updatedAt: string;
  streaming: boolean;
}

// ─── Store state ──────────────────────────────────────────────────────────────
// NOTE: No activeSessionId here — each tab instance owns that locally.

export interface AssistantState {
  sessions: AssistantSession[];
  /** True while a server sync is in progress — for loading indicators. */
  syncing: boolean;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type AssistantAction =
  | { type: 'CREATE_SESSION'; session: AssistantSession }
  | { type: 'DELETE_SESSION'; id: string }
  | { type: 'RENAME_SESSION'; id: string; title: string }
  | { type: 'ADD_MESSAGE'; sessionId: string; message: AssistantMessage }
  | { type: 'UPDATE_MESSAGE'; sessionId: string; messageId: string; content: string }
  | { type: 'FINALIZE_MESSAGE'; sessionId: string; messageId: string; content: string; tokenUsage?: TokenUsage }
  | { type: 'SET_STREAMING'; sessionId: string; streaming: boolean }
  | { type: 'UPDATE_CONFIG'; sessionId: string; config: Partial<AssistantSessionConfig> }
  | { type: 'CLEAR_MESSAGES'; sessionId: string }
  /** Replace the entire sessions array (used after server sync / merge). */
  | { type: 'LOAD_SESSIONS'; sessions: AssistantSession[] }
  | { type: 'SET_SYNCING'; syncing: boolean };

// ─── Default config ───────────────────────────────────────────────────────────

export const DEFAULT_SESSION_CONFIG: AssistantSessionConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  useProxy: false,
};

// ─── Reducer ─────────────────────────────────────────────────────────────────

function reducer(state: AssistantState, action: AssistantAction): AssistantState {
  switch (action.type) {
    case 'CREATE_SESSION':
      return { ...state, sessions: [action.session, ...state.sessions] };

    case 'DELETE_SESSION':
      return { ...state, sessions: state.sessions.filter(s => s.id !== action.id) };

    case 'RENAME_SESSION':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id === action.id ? { ...s, title: action.title, updatedAt: new Date().toISOString() } : s,
        ),
      };

    case 'ADD_MESSAGE':
      return {
        ...state,
        sessions: state.sessions.map(s => {
          if (s.id !== action.sessionId) return s;
          const isFirstUser = s.messages.length === 0 && action.message.role === 'user';
          return {
            ...s,
            messages: [...s.messages, action.message],
            updatedAt: new Date().toISOString(),
            title: isFirstUser
              ? action.message.content.slice(0, 60).replace(/\n/g, ' ').trim() || s.title
              : s.title,
          };
        }),
      };

    case 'UPDATE_MESSAGE':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id !== action.sessionId ? s : {
            ...s,
            messages: s.messages.map(m =>
              m.id === action.messageId ? { ...m, content: action.content } : m,
            ),
          },
        ),
      };

    case 'FINALIZE_MESSAGE':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id !== action.sessionId ? s : {
            ...s,
            updatedAt: new Date().toISOString(),
            messages: s.messages.map(m =>
              m.id === action.messageId
                ? { ...m, content: action.content, streaming: false, ...(action.tokenUsage && { tokenUsage: action.tokenUsage }) }
                : m,
            ),
          },
        ),
      };

    case 'SET_STREAMING':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id === action.sessionId ? { ...s, streaming: action.streaming } : s,
        ),
      };

    case 'UPDATE_CONFIG':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id === action.sessionId ? { ...s, config: { ...s.config, ...action.config } } : s,
        ),
      };

    case 'CLEAR_MESSAGES':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id === action.sessionId
            ? { ...s, messages: [], updatedAt: new Date().toISOString() }
            : s,
        ),
      };

    case 'LOAD_SESSIONS':
      return { ...state, sessions: action.sessions };

    case 'SET_SYNCING':
      return { ...state, syncing: action.syncing };

    default:
      return state;
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const LS_KEY = 'ca_assistant_sessions_v2';

function persistState(state: AssistantState): void {
  try {
    const safe: AssistantState = {
      syncing: false,
      sessions: state.sessions.map(s => ({
        ...s,
        streaming: false,
        config: { ...s.config, apiKey: undefined },
        messages: s.messages.map(m => ({ ...m, streaming: false, tokenUsage: m.tokenUsage })),
      })),
    };
    localStorage.setItem(LS_KEY, JSON.stringify(safe));
  } catch { /* quota exceeded */ }
}

function loadPersistedState(): AssistantState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { sessions: [], syncing: false };
    const parsed = JSON.parse(raw) as Partial<AssistantState>;
    if (!Array.isArray(parsed.sessions)) return { sessions: [], syncing: false };
    return { sessions: parsed.sessions, syncing: false };
  } catch {
    return { sessions: [], syncing: false };
  }
}

// ─── Server sync utilities ────────────────────────────────────────────────────
// These are called from AssistantTab. All server calls are best-effort —
// failures fall back to localStorage silently; no error is surfaced to the user.

let _syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced (1500ms) PUT of the full sessions array to the server. */
export function syncToServer(sessions: AssistantSession[]): void {
  if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(async () => {
    try {
      // Strip API keys and transient streaming flags before sending
      const safe = sessions.map(s => ({
        ...s,
        streaming: false,
        config: { provider: s.config.provider, model: s.config.model, useProxy: s.config.useProxy },
        messages: s.messages.map(m => ({ ...m, streaming: false })),
      }));
      await fetch('/api/assistant/sessions', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessions: safe }),
      });
    } catch (err) {
      console.warn('[assistant] Failed to sync sessions to server:', err);
    }
  }, 1500);
}

/** Load sessions from the server and merge with localStorage (server wins on conflict). */
export async function loadFromServer(dispatch: Dispatch<AssistantAction>): Promise<void> {
  try {
    const res = await fetch('/api/assistant/sessions', { credentials: 'include' });
    if (!res.ok) return;
    const body = await res.json() as { sessions?: unknown };
    if (!Array.isArray(body.sessions) || body.sessions.length === 0) return;
    const serverSessions = body.sessions as AssistantSession[];

    // Read local sessions for merge comparison
    const localSessions: AssistantSession[] = (() => {
      try {
        const p = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Partial<AssistantState>;
        return Array.isArray(p.sessions) ? p.sessions : [];
      } catch { return []; }
    })();

    // Merge: server wins when updatedAt is equal or newer
    const merged = new Map<string, AssistantSession>();
    for (const s of localSessions) merged.set(s.id, s);
    for (const s of serverSessions) {
      const existing = merged.get(s.id);
      if (!existing || new Date(s.updatedAt) >= new Date(existing.updatedAt)) {
        merged.set(s.id, s);
      }
    }

    const mergedArr = [...merged.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    dispatch({ type: 'LOAD_SESSIONS', sessions: mergedArr });
  } catch (err) {
    console.warn('[assistant] Failed to load sessions from server:', err);
  }
}

/** Load persisted model config (provider/model/useProxy) from the server. */
export async function loadModelConfig(): Promise<{ provider: string; model: string; useProxy: boolean } | null> {
  try {
    const res = await fetch('/api/assistant/model-config', { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json() as { provider: string; model: string; useProxy: boolean };
  } catch {
    return null;
  }
}

/** Persist model config (provider/model/useProxy) to the server. API key is never sent. */
export async function saveModelConfig(config: { provider: string; model: string; useProxy: boolean }): Promise<void> {
  try {
    await fetch('/api/assistant/model-config', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    });
  } catch (err) {
    console.warn('[assistant] Failed to save model config:', err);
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AssistantContextValue {
  state: AssistantState;
  dispatch: Dispatch<AssistantAction>;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadPersistedState);
  useEffect(() => { persistState(state); }, [state]);
  return (
    <AssistantContext.Provider value={{ state, dispatch }}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistantStore(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistantStore must be used inside AssistantProvider');
  return ctx;
}
