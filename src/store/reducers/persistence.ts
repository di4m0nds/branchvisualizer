// ─── localStorage persistence + boot loading ─────────────────────────────────
// Everything that reads or writes persisted state lives here: pref loaders,
// session/project blobs (with migration), and the persist taps AppContext
// drives. No reducer cases — pure load/save helpers.

import type { AppState, ChatBackground, LogDensity, ModelRef } from '../../types';
import type { AgentMessage, PinnedRule, Project, Session } from '../../types/session';
import { DEFAULT_PINNED_RULES, createDefaultContext, nextId, sessionProjectKey } from '../../types/session';
import type { ContextSizeId } from '../../lib/agent/transport';
import { swallow } from '../../lib/log';

const PINNED_RULES_STORAGE_KEY = 'code-agent:pinned_rules';
const CURRENT_MODEL_STORAGE_KEY = 'code-agent:current_model';
const SESSIONS_STORAGE_KEY = 'code-agent:sessions';
const PROJECTS_STORAGE_KEY = 'code-agent:projects';
const ACTIVE_SESSION_STORAGE_KEY = 'code-agent:active_session';
export const SHOW_CHECKPOINTS_STORAGE_KEY = 'code-agent:show_checkpoints';
export const LOG_DENSITY_STORAGE_KEY = 'code-agent:log_density';
export const TERMINAL_FONT_STORAGE_KEY = 'code-agent:terminal_font';
export const CHAT_FONT_STORAGE_KEY = 'code-agent:chat_font';
export const CHAT_BACKGROUND_STORAGE_KEY = 'code-agent:chat_background';

/** Read one localStorage pref through a parser; any failure yields the fallback. */
function loadPref<T>(key: string, parse: (raw: string) => T | null, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(raw) ?? fallback;
  } catch (e) {
    swallow('prefs', `load ${key}`)(e);
    return fallback;
  }
}

export const loadBoolPref = (key: string, fallback: boolean): boolean =>
  loadPref(key, (raw) => raw === 'true', fallback);

export const loadLogDensity = (): LogDensity =>
  loadPref<LogDensity>(LOG_DENSITY_STORAGE_KEY, (raw) => (raw === 'clean' ? 'clean' : 'verbose'), 'verbose');

export const loadFontPref = (key: string): string | null =>
  loadPref<string | null>(key, (raw) => (raw.length > 0 ? raw : null), null);

const CHAT_BACKGROUNDS: ChatBackground[] = ['none', 'dots', 'grid', 'scanlines'];
export const loadChatBackground = (): ChatBackground =>
  loadPref<ChatBackground>(
    CHAT_BACKGROUND_STORAGE_KEY,
    (raw) => ((CHAT_BACKGROUNDS as string[]).includes(raw) ? (raw as ChatBackground) : null),
    'none',
  );

/** Cap persisted history so the localStorage blob stays bounded. */
const MAX_PERSISTED_MESSAGES = 100;

// Sessions are persisted so they survive reloads and are reachable from the
// visualizer views. We strip runtime-only fields (live terminals, mid-stream
// flags, transient status) and cap history length before writing.
function stripSessionForStorage(s: Session): Session {
  const trimmed = s.messages.length > MAX_PERSISTED_MESSAGES;
  return {
    ...s,
    terminals: [],
    context: { ...s.context, status: 'idle' },
    historyTrimmed: s.historyTrimmed || trimmed || undefined,
    messages: s.messages
      .slice(-MAX_PERSISTED_MESSAGES)
      // Drop `hiddenText` (resolved @-file contents, up to ~192 KB per message)
      // so reference-heavy sessions can't blow the localStorage quota and stop
      // ALL persistence. After a reload the contents would be stale anyway —
      // the chips (`refs`) survive, and the agent re-reads files via tools.
      .map(({ hiddenText: _hidden, ...m }) => ({
        ...m,
        streaming: false,
        // Attachment BYTES never persist (quota); metadata chips survive.
        ...(m.attachments?.length
          ? { attachments: m.attachments.map(({ base64: _b64, ...a }) => a) }
          : {}),
      })),
  };
}

function readRawSessions(): Session[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Session[]) : [];
  } catch (e) {
    swallow('sessions', 'read persisted sessions')(e);
    return [];
  }
}

// basename() without pulling in path polyfills — enough for local paths and
// `owner/repo` refs. Strips trailing slashes so `/foo/bar/` → `bar`.
function baseNameFromKey(key: string): string {
  const trimmed = key.replace(/[/\\]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return (idx >= 0 ? trimmed.slice(idx + 1) : trimmed) || key;
}

// Synthesize a Project per unique sessionProjectKey so first-run after upgrade
// gets a coherent Projects → Threads view. Run once — subsequent loads read
// the persisted `code-agent:projects` blob directly.
function migrateProjectsFromSessions(sessions: Session[]): Project[] {
  const byKey = new Map<string, { source: 'local' | 'github'; earliest: number }>();
  for (const s of sessions) {
    const key = sessionProjectKey(s);
    const first = s.messages[0];
    const t = first ? new Date(first.ts).getTime() : Number.NaN;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { source: s.repoSource, earliest: Number.isFinite(t) ? t : Number.POSITIVE_INFINITY });
    else if (Number.isFinite(t) && t < prev.earliest) prev.earliest = t;
  }
  const fallbackTs = new Date(0).toISOString();
  return Array.from(byKey.entries()).map(([key, meta]) => ({
    id: nextId('project'),
    name: baseNameFromKey(key),
    path: key,
    source: meta.source,
    createdAt: Number.isFinite(meta.earliest) ? new Date(meta.earliest).toISOString() : fallbackTs,
  }));
}

function loadProjects(sessions: Session[]): Project[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Project[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) { swallow('projects', 'load persisted projects; falling back to migration')(e); }
  return migrateProjectsFromSessions(sessions);
}

function loadSessions(projects?: Project[]): Session[] {
  const raw = readRawSessions();
  if (raw.length === 0) return [];
  // If projects were provided, backfill any missing projectId by matching
  // sessionProjectKey → project.path. Older persisted sessions lack the field.
  const pathToId = projects
    ? new Map(projects.map((p) => [p.path, p.id]))
    : null;
  return raw.map((s) => {
    const projectId = s.projectId || (pathToId?.get(sessionProjectKey(s)) ?? '');
    return {
      ...s,
      projectId,
      terminals: [],
      messages: dedupeMessageIds(Array.isArray(s.messages) ? s.messages : []),
      context: { ...createDefaultContext(), ...s.context, status: 'idle' },
      // Per-session model migration: sessions persisted before modelConfig
      // existed adopt the global model as of THIS load; the global selection
      // becomes "default for new sessions" and never mutates them again.
      modelConfig: s.modelConfig
        ? { ...s.modelConfig, model: normalizeModelRef(s.modelConfig.model) }
        : { model: loadCurrentModel() },
    };
  });
}

// Heal blobs written before ids were boot-scoped: a reload back then re-minted
// `msg_1…` and could persist duplicate ids, which break React keys and make
// UPDATE_AGENT_MESSAGE patch the wrong message. Re-mint any repeat on load.
function dedupeMessageIds(messages: AgentMessage[]): AgentMessage[] {
  const seen = new Set<string>();
  return messages.map((m) => {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      return m;
    }
    const fresh = nextId(m.role === 'user' ? 'msg_u' : 'msg_a');
    seen.add(fresh);
    return { ...m, id: fresh };
  });
}

function loadActiveSessionId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string | null) : null;
  } catch (e) {
    swallow('sessions', 'load active session id')(e);
    return null;
  }
}

/** Persist projects + sessions + active id (debounced by the caller). Write
 *  in one tick so a mid-write reload can't produce dangling projectId refs. */
export function persistSessions(state: AppState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(state.projects));
    localStorage.setItem(
      SESSIONS_STORAGE_KEY,
      JSON.stringify(state.sessions.map(stripSessionForStorage)),
    );
    localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(state.activeSessionId));
  } catch (e) { swallow('sessions', 'persist (quota / private mode)')(e); }
}

export function loadPinnedRules(): PinnedRule[] {
  if (typeof localStorage === 'undefined') return DEFAULT_PINNED_RULES.map((r) => ({ ...r }));
  try {
    const raw = localStorage.getItem(PINNED_RULES_STORAGE_KEY);
    if (!raw) return DEFAULT_PINNED_RULES.map((r) => ({ ...r }));
    const parsed = JSON.parse(raw) as PinnedRule[];
    if (!Array.isArray(parsed)) return DEFAULT_PINNED_RULES.map((r) => ({ ...r }));
    return parsed;
  } catch (e) {
    swallow('prefs', 'load pinned rules')(e);
    return DEFAULT_PINNED_RULES.map((r) => ({ ...r }));
  }
}

// Default selection: Claude Code (subscription/CLI) on the `sonnet` family alias
// at standard context — works out of the box on any plan, no 1M usage-credit
// requirement (the old default pinned a 1M-context model on the direct API).
const DEFAULT_MODEL: ModelRef = { providerId: 'claude_code', modelId: 'sonnet', context: 'standard' };

/** Normalize a persisted (or default) model ref: default context to 'standard'
 *  and heal the Haiku id drift (`claude-haiku-4-5-20251001` → `claude-haiku-4-5`)
 *  so old blobs keep working with the deduped model lists. */
export function normalizeModelRef(raw: unknown): ModelRef {
  const r = (raw ?? {}) as Partial<ModelRef>;
  const providerId = r.providerId ?? DEFAULT_MODEL.providerId;
  let modelId = r.modelId ?? DEFAULT_MODEL.modelId;
  if (modelId === 'claude-haiku-4-5-20251001') modelId = 'claude-haiku-4-5';
  const context: ContextSizeId = r.context === '1m' ? '1m' : 'standard';
  return { providerId, modelId, context };
}

export function loadCurrentModel(): ModelRef {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_MODEL };
  try {
    const raw = localStorage.getItem(CURRENT_MODEL_STORAGE_KEY);
    if (raw) return normalizeModelRef(JSON.parse(raw));
  } catch (e) { swallow('prefs', 'load current model')(e); }
  return { ...DEFAULT_MODEL };
}

/** Persist model + pinned rules through a reducer post-tap. */
export function persistState(state: AppState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PINNED_RULES_STORAGE_KEY, JSON.stringify(state.pinnedRules));
    localStorage.setItem(CURRENT_MODEL_STORAGE_KEY, JSON.stringify(state.currentModel));
    localStorage.setItem(SHOW_CHECKPOINTS_STORAGE_KEY, String(state.showCheckpoints));
    localStorage.setItem(LOG_DENSITY_STORAGE_KEY, state.logDensity);
    if (state.terminalFont) {
      localStorage.setItem(TERMINAL_FONT_STORAGE_KEY, state.terminalFont);
    } else {
      localStorage.removeItem(TERMINAL_FONT_STORAGE_KEY);
    }
    if (state.chatFont) {
      localStorage.setItem(CHAT_FONT_STORAGE_KEY, state.chatFont);
    } else {
      localStorage.removeItem(CHAT_FONT_STORAGE_KEY);
    }
    localStorage.setItem(CHAT_BACKGROUND_STORAGE_KEY, state.chatBackground);
  } catch (e) { swallow('prefs', 'persist (quota / private mode)')(e); }
}

// Bootstrap: load raw sessions once, derive projects (or reuse persisted ones),
// backfill session.projectId from the resolved projects, resolve the active id.
export function bootstrapProjectsAndSessions(): { projects: Project[]; sessions: Session[]; activeSessionId: string | null } {
  const rawSessions = readRawSessions();
  const projects = loadProjects(rawSessions);
  const sessions = loadSessions(projects);
  const persistedId = loadActiveSessionId();
  const activeSessionId = persistedId && sessions.some((s) => s.id === persistedId) ? persistedId : null;
  return { projects, sessions, activeSessionId };
}
