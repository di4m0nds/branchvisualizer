// ─── Agent session model ────────────────────────────────────────────────────
// Mirrors the `<session_context>` block from the system-prompt document. Each
// session owns its permission posture, build mode, reasoning budget, skills,
// pinned rules, and conversation. This is the state the harness renders in the
// IDE chrome and injects into the agent each turn (M4).

import type { RepoSource } from './index';

export type AccessLevel = 'supervised' | 'auto_accept' | 'full_access';
export type BuildMode = 'direct' | 'planning';
export type ReasoningBudget = 'low' | 'medium' | 'high' | 'max';

/**
 * Session lifecycle state, following the document's state machine:
 * idle → running → working → planning → pending_plan_approval → complete | error.
 * `awaiting_approval` covers the supervised per-action gate.
 */
export type SessionStatus =
  | 'idle'
  | 'running'
  | 'working'
  | 'planning'
  | 'pending_plan_approval'
  | 'awaiting_approval'
  /** Blocked on structured user input (questions_for_user popup open). */
  | 'awaiting_input'
  | 'complete'
  | 'error';

/** An inviolable session-level constraint. Cannot be overridden mid-session. */
export interface PinnedRule {
  id: string;
  text: string;
  /**
   * Optional matcher: tool name + a substring/regex source that, if matched
   * against a tool call's serialized input, blocks execution at ALL access
   * levels. Enforced in the agent loop, not by the model.
   */
  block?: { tools: string[]; pattern: string };
}

/** A behavioral skill toggle (test_first, security_review, minimal_diff, …). */
export interface SkillFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface ContextTokens {
  used: number;
  max: number;
}

export interface SessionContext {
  accessLevel: AccessLevel;
  buildMode: BuildMode;
  reasoningBudget: ReasoningBudget;
  deepThinking: boolean;
  deepCoding: boolean;
  fastMode: boolean;
  contextTokens: ContextTokens;
  gitBranch: string | null;
  gitStatusSummary: string | null;
  skills: SkillFlag[];
  pinnedRules: PinnedRule[];
  status: SessionStatus;
  /** Once the user has explicitly approved bypass permissions for the Claude
   *  Code CLI in this session (via the cli_approval_needed card), we pass
   *  `--permission-mode bypassPermissions` to the CLI for every subsequent
   *  turn until the session is reset. Undefined ↔ false. */
  cliBypass?: boolean;
  /** Podman runtime sandbox: when enabled, the agent's `run_command` executes
   *  inside an isolated container (session root bind-mounted at the same
   *  path). `network` toggles container network access. Undefined ↔ disabled.
   *  Persisted with the session context. */
  sandbox?: { enabled: boolean; network: boolean };
}

// ─── Conversation ────────────────────────────────────────────────────────────

export type AgentRole = 'user' | 'assistant';

/** A structured block parsed from the agent's streamed output (M4). */
export interface AgentBlock {
  type: string; // 'text' | 'thinking' | 'pending_action' | 'plan' | 'file_changes' | …
  raw: string;
  // Loosely-typed payload; specific renderers narrow it.
  data?: Record<string, unknown>;
}

/** An `@path` workspace reference attached to a user message. */
export interface MessageRef {
  /** The token as typed, e.g. `@src/lib/fuzzy.ts`. */
  token: string;
  /** Workspace-relative path the token resolved to. */
  path: string;
  kind: 'file' | 'folder';
  status: 'ok' | 'truncated' | 'error';
  /** Human-readable detail for truncated/error refs ("first 1200 lines", "not found"). */
  note?: string;
}

export interface AgentMessage {
  id: string;
  role: AgentRole;
  /** Rendered text (for user messages and streamed assistant text). */
  text: string;
  /** Prompt-only sidecar (e.g. resolved `@file` contents). Sent to the model
   *  ahead of `text` on every conversation rebuild, never rendered in the UI. */
  hiddenText?: string;
  /** Resolved `@path` references, rendered as chips on the user bubble. */
  refs?: MessageRef[];
  /** Structured blocks parsed from assistant output. Populated once the turn
   *  settles; kept empty during streaming (blocks are derived at render time
   *  from `text`/`thinking` so the hot streaming path never re-parses). */
  blocks: AgentBlock[];
  /** Extended-thinking text accumulated during streaming (a separate delta
   *  stream, not part of `text`). Surfaced as a synthetic `thinking` block. */
  thinking?: string;
  /** True while the assistant message is still streaming. */
  streaming?: boolean;
  ts: string; // ISO timestamp (turn start — shared across a turn's messages)
  /** Wall-clock ISO time this message finished streaming (assistant only). */
  endTs?: string;
  /** How long this message took to produce, in ms (assistant only). Rendered as
   *  a per-message footer alongside the finish time. */
  durationMs?: number;
  /** Token usage for the turn that produced this message (assistant only) —
   *  cumulative across the turn's tool-loop iterations. Feeds cost telemetry. */
  usage?: { input: number; output: number; modelId?: string };
  /** Files attached to a user message. `base64` payloads are dropped at
   *  persistence time (metadata chips survive; bytes don't). */
  attachments?: {
    kind: 'image' | 'document';
    mime: string;
    name: string;
    sizeBytes: number;
    base64?: string;
    path?: string;
  }[];
}

export type TerminalId = string;

/** A user comment anchored to a section of the conversation's plan. */
export interface PlanComment {
  id: string;
  /** The plan message this comment was made against (staleness detection). */
  messageId: string;
  /** PlanSection.id it targets. */
  sectionId: string;
  /** Snapshot of the section heading for display + feedback composition. */
  sectionHeading: string;
  text: string;
  createdAt: string;
  /** Set once the comment has been sent to the agent as feedback. */
  resolved?: boolean;
}

export interface Session {
  id: string;
  title: string;
  /** Owning project (persisted). Backfilled by migration for pre-existing sessions. */
  projectId: string;
  repoSource: RepoSource;
  /** owner/repo for GitHub, or an absolute path for local. */
  repoRef: string;
  /** Working directory the agent's tools operate in (local repos only). */
  cwd: string | null;
  context: SessionContext;
  messages: AgentMessage[];
  terminals: TerminalId[];
  /** Hidden from the main sidebar list when true; restorable from Settings. */
  archived?: boolean;
  /** Set when persistence dropped messages beyond the storage cap, so the UI
   *  can tell the user the transcript is incomplete rather than trimming
   *  silently. */
  historyTrimmed?: boolean;
  /** User annotations on the implementation plan (Plan view). */
  planComments?: PlanComment[];
  /** Edited-in-place plan text, keyed to the plan message it revises. */
  planDraft?: { messageId: string; text: string } | null;
}

// ─── Project ─────────────────────────────────────────────────────────────────
// A project groups threads (sessions) that share a repo root. Explicit entity
// so users can create empty projects, rename them, and archive/delete them
// independently of any single thread. The canonical join key between Project
// and Session is `Project.path === sessionProjectKey(session)`.

export interface Project {
  id: string;
  /** User-editable label. Defaults to the last segment of `path`. */
  name: string;
  /**
   * Canonical repo identity. Absolute path for local, `owner/repo` for github.
   * Same value returned by `sessionProjectKey` for any session in this project.
   */
  path: string;
  source: RepoSource;
  createdAt: string;
  /** Archived projects are hidden from the main sidebar list. */
  archived?: boolean;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_SKILLS: SkillFlag[] = [
  { id: 'test_first', name: 'test_first', description: 'Write or propose tests before implementation.', enabled: false },
  { id: 'security_review', name: 'security_review', description: 'Flag vulnerabilities after touching input/auth/secrets/network.', enabled: false },
  { id: 'explain_changes', name: 'explain_changes', description: 'Append a plain-English summary after each change.', enabled: false },
  { id: 'minimal_diff', name: 'minimal_diff', description: 'Make the smallest change; do not refactor unrelated code.', enabled: true },
  { id: 'performance_notes', name: 'performance_notes', description: 'Flag introduced complexity, allocations, or blocking ops.', enabled: false },
  { id: 'accessibility', name: 'accessibility', description: 'UI code includes ARIA, keyboard nav, contrast.', enabled: false },
];

export const DEFAULT_PINNED_RULES: PinnedRule[] = [
  {
    id: 'no_commit_push',
    text: 'Do not commit or push anything.',
    block: { tools: ['run_command', 'git_commit', 'git_push'], pattern: 'git\\s+(commit|push)' },
  },
];

export function createDefaultContext(): SessionContext {
  return {
    accessLevel: 'supervised',
    buildMode: 'direct',
    reasoningBudget: 'high',
    deepThinking: false,
    deepCoding: true,
    fastMode: false,
    contextTokens: { used: 0, max: 1_000_000 },
    gitBranch: null,
    gitStatusSummary: null,
    skills: DEFAULT_SKILLS.map((s) => ({ ...s })),
    pinnedRules: DEFAULT_PINNED_RULES.map((r) => ({ ...r })),
    status: 'idle',
  };
}

let _seq = 0;
// Boot-scoped id namespace: sessions (and their message ids) persist to
// localStorage, so a bare counter restarting at 0 after reload would mint ids
// that collide with restored ones — streamed updates then patch the wrong
// message and React keys clash ("disappearing messages"). Salting with the
// boot time keeps ids monotonic within a run and unique across runs.
const _boot = Date.now().toString(36);
/** Monotonic id, unique across app restarts. */
export function nextId(prefix: string): string {
  _seq += 1;
  return `${prefix}_${_boot}_${_seq.toString(36)}`;
}

/**
 * Stable identity of a session's *project* (repo + working tree). Sessions that
 * share a project key are the same filesystem context — switching between them
 * must not re-init the terminal/nvim/branchvisualizer, only the agent view.
 * Local sessions key off their cwd; GitHub sessions off their repoRef.
 */
export function sessionProjectKey(s: Session): string {
  return s.repoSource === 'local' ? (s.cwd ?? s.repoRef) : s.repoRef;
}
