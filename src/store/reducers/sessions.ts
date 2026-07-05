// ─── Agent sessions domain ───────────────────────────────────────────────────
// Session lifecycle, per-session context patches, conversation messages, and
// plan-view annotations.

import type { AppAction, AppState } from '../../types';
import type { Session, SessionContext } from '../../types/session';
import { nextId } from '../../types/session';

// Immutably update one session's fields by id.
export function mapSession(state: AppState, id: string, fn: (s: Session) => Session): AppState {
  return { ...state, sessions: state.sessions.map((s) => (s.id === id ? fn(s) : s)) };
}

// Immutably patch one session's context by id.
export function patchContext(state: AppState, id: string, patch: Partial<SessionContext>): AppState {
  return mapSession(state, id, (s) => ({ ...s, context: { ...s.context, ...patch } }));
}

// Derive a concise conversation title from the first user prompt: first
// non-empty line, whitespace-collapsed, smart-truncated.
const TITLE_MAX = 48;
function deriveSessionTitle(text: string): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const clean = firstLine.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New session';
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…` : clean;
}

export function sessionsReducer(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
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

    case 'ARCHIVE_SESSION':
      return mapSession(state, action.id, (s) => ({ ...s, archived: action.archived }));

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
      return mapSession(state, action.sessionId, (s) => {
        // Auto-title from the first user message while the title is still a
        // placeholder (or a legacy copy of the project name).
        let title = s.title;
        const isFirstUser = action.message.role === 'user' && !s.messages.some((m) => m.role === 'user');
        if (isFirstUser) {
          const proj = state.projects.find((p) => p.id === s.projectId);
          const isPlaceholder = s.title === 'New session' || (!!proj && s.title === proj.name);
          if (isPlaceholder) title = deriveSessionTitle(action.message.text);
        }
        // Defensive: sessions persisted before ids were boot-scoped can contain
        // ids a fresh counter re-mints. A duplicate key would make streamed
        // UPDATE_AGENT_MESSAGE patches land on the old message — remint instead.
        let message = action.message;
        if (s.messages.some((m) => m.id === message.id)) {
          message = { ...message, id: nextId(message.role === 'user' ? 'msg_u' : 'msg_a') };
        }
        return { ...s, title, messages: [...s.messages, message] };
      });

    case 'RENAME_SESSION':
      return mapSession(state, action.id, (s) => ({ ...s, title: action.title }));

    case 'UPDATE_AGENT_MESSAGE':
      return mapSession(state, action.sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === action.messageId ? { ...m, ...action.patch } : m,
        ),
      }));

    case 'TRUNCATE_MESSAGES_BEFORE':
      return mapSession(state, action.sessionId, (s) => {
        const idx = s.messages.findIndex((m) => m.id === action.beforeMessageId);
        if (idx < 0) return s;
        return { ...s, messages: s.messages.slice(0, idx) };
      });

    case 'SET_SESSION_CLI_BYPASS':
      return patchContext(state, action.sessionId, { cliBypass: action.bypass });

    // ── Per-session model config ──
    case 'SET_SESSION_MODEL':
      return mapSession(state, action.sessionId, (s) => ({
        ...s,
        modelConfig: { ...s.modelConfig, model: action.model },
      }));

    case 'PATCH_SESSION_MODEL_CONFIG':
      return mapSession(state, action.sessionId, (s) => ({
        ...s,
        modelConfig: {
          // Healed at load time, but defend against a session that somehow
          // lacks a config: fall back to the global model.
          model: s.modelConfig?.model ?? state.currentModel,
          ...s.modelConfig,
          ...action.patch,
        },
      }));

    // ── Plan view ──
    case 'ADD_PLAN_COMMENT':
      return mapSession(state, action.sessionId, (s) => ({
        ...s,
        planComments: [...(s.planComments ?? []), action.comment],
      }));

    case 'UPDATE_PLAN_COMMENT':
      return mapSession(state, action.sessionId, (s) => ({
        ...s,
        planComments: (s.planComments ?? []).map((c) =>
          c.id === action.commentId ? { ...c, ...action.patch } : c,
        ),
      }));

    case 'REMOVE_PLAN_COMMENT':
      return mapSession(state, action.sessionId, (s) => ({
        ...s,
        planComments: (s.planComments ?? []).filter((c) => c.id !== action.commentId),
      }));

    case 'SET_PLAN_DRAFT':
      return mapSession(state, action.sessionId, (s) => ({ ...s, planDraft: action.draft }));

    default:
      return null;
  }
}
