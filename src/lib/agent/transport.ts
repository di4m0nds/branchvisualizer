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

export interface NeutralMessage {
  role: 'user' | 'assistant';
  content: NeutralContent[];
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
}

export interface AgentTransport {
  /** Provider + model id the transport serves. */
  readonly id: string;
  readonly modelId: string;
  createMessage(req: AgentRequest, cbs: StreamCallbacks): Promise<NeutralResponse>;
}

// ─── Provider registry ──────────────────────────────────────────────────────

export type ConnectionTier = 'free' | 'paid' | 'unknown';

export interface ModelInfo {
  id: string;
  label: string;
  /** Best-effort default tier hint; probe() may override. */
  defaultTier?: ConnectionTier;
  /** Hard context limit if known. */
  contextTokens?: number;
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
  /** Build a transport for one of this provider's models. */
  createTransport(modelId: string): Promise<AgentTransport>;
}
