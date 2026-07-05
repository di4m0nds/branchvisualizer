// ─── Agent transport (provider-neutral) ────────────────────────────────────
// A single, provider-agnostic message shape used by the agent loop. Each
// provider adapter (anthropic, openai_codex, gemini, minimax, opencode) converts
// this to/from its own SDK types. The loop stays identical across providers so
// pinned-rule enforcement, access-level gating, streaming plumbing, and the
// action-log UI never fork.

// ─── Neutral content model ─────────────────────────────────────────────────

export type NeutralContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

/** A user-attached file travelling with a message. Images and PDFs only for
 *  now (video is deferred). `base64` is present in-memory for the send; it is
 *  stripped at persistence time (only metadata survives reloads). `path` (the
 *  original absolute path) lets subprocess providers (Claude Code) read the
 *  file themselves instead of receiving bytes. */
export interface NeutralAttachment {
  kind: 'image' | 'document';
  mime: string;
  name: string;
  sizeBytes: number;
  base64?: string;
  path?: string;
}

export interface NeutralMessage {
  role: 'user' | 'assistant';
  content: NeutralContent[];
  /** Files attached to a user message (images/PDFs). Providers map what they
   *  accept and gracefully skip the rest. */
  attachments?: NeutralAttachment[];
}

export type NeutralStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'refusal'
  | 'pause';

export interface NeutralUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  total: number;
}

export interface NeutralResponse {
  content: NeutralContent[];
  stopReason: NeutralStopReason;
  usage: NeutralUsage;
  /** Model id the provider actually served (for the tier/label chip). */
  providerModel: string;
}

// ─── Neutral tool definition ────────────────────────────────────────────────

export interface NeutralToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ─── Request envelope ───────────────────────────────────────────────────────

export interface StreamCallbacks {
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
}

export interface AgentRequest {
  system: string;
  messages: NeutralMessage[];
  tools: NeutralToolSchema[];
  maxTokens: number;
  effort: 'low' | 'medium' | 'high' | 'max';
  /** Enable adaptive/extended thinking for this turn. Provider-specific mapping. */
  thinking: boolean;
  /** Sampling temperature (per-session model config). API providers map it to
   *  their native param; CLI/subprocess providers ignore it. Undefined =
   *  provider default. Anthropic: must be omitted when `thinking` is on. */
  temperature?: number;
  /** Working directory for the turn. Used by subprocess providers (Claude Code)
   *  that run a real agent in the repo; ignored by API providers. */
  cwd?: string | null;
  /** Abort signal for the Stop button. Providers should honour it best-effort:
   *  API providers pass it to their SDK; the Claude Code provider kills the
   *  subprocess via `claude_code_kill`. */
  signal?: AbortSignal;
  /** Claude Code CLI permission mode. When the user has approved bypass for
   *  the session (see `SessionContext.cliBypass`) or is on `full_access`, the
   *  loop sets this to `bypassPermissions`. Otherwise defaults to
   *  `acceptEdits`. Ignored by non-CLI providers. */
  permissionMode?: string;
  /** Text appended to the CLI's own system prompt via `--append-system-prompt`.
   *  Used to deliver the IDE's rendering conventions AND the session's active
   *  skill flags through the CLI's sanctioned channel (in-band prepending
   *  triggers the CLI's prompt-injection guard). Ignored by non-CLI providers. */
  appendSystem?: string;
}

export interface AgentTransport {
  /** Provider + model id the transport serves. */
  readonly id: string;
  readonly modelId: string;
  /** Context-size variant the transport was built for (defaults to 'standard'). */
  readonly contextSize?: ContextSizeId;
  createMessage(req: AgentRequest, cbs: StreamCallbacks): Promise<NeutralResponse>;
}

// ─── Provider registry ──────────────────────────────────────────────────────

export type ConnectionTier = 'free' | 'paid' | 'unknown';

/** Which context-window variant of a model to run. 'standard' is always the
 *  default and the one every plan can serve; '1m' opts into the 1M-token
 *  window (usage-credit gated on Claude Code subscriptions). */
export type ContextSizeId = 'standard' | '1m';

export interface ContextOption {
  id: ContextSizeId;
  label: string;
  tokens: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  /** Best-effort default tier hint; probe() may override. */
  defaultTier?: ConnectionTier;
  /** Standard (default) context limit if known. */
  contextTokens?: number;
  /** Selectable context-window variants. Ordered — element 0 must be
   *  'standard' and is the default. Absent (or a single entry) ⇒ the model is
   *  standard-only and the picker never offers 1M. */
  contextOptions?: ContextOption[];
}

export type ProbeState = 'not_detected' | 'detected' | 'connected';

export interface ProbeResult {
  state: ProbeState;
  tier: ConnectionTier;
  /** Human-readable status text ("no API key", "codex CLI v0.14, ChatGPT plan"). */
  label: string;
  /** Optional error surfaced from a live check. */
  error?: string;
  /** Optional detected version. */
  version?: string;
}

export interface Provider {
  id: string;
  label: string;
  /** Short blurb for the model picker. */
  description: string;
  models(): ModelInfo[];
  /** Fast liveness/tier check. Cached in state.providerStatus. */
  probe(): Promise<ProbeResult>;
  /** Build a transport for one of this provider's models, at the given
   *  context-window variant (defaults to 'standard'). */
  createTransport(modelId: string, context?: ContextSizeId): Promise<AgentTransport>;
}
