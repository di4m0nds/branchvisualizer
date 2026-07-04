import Anthropic from '@anthropic-ai/sdk';
import { makeKeyResolver, probeWithKey } from './shared';
import type {
  AgentRequest, AgentTransport, ContextSizeId, ModelInfo, NeutralContent, NeutralResponse,
  NeutralStopReason, NeutralUsage, ProbeResult, Provider, StreamCallbacks,
} from '../transport';
import { STD_ONLY, STD_OR_1M } from './claudeModels';

// Anthropic model IDs are date-suffixed on the API. Using the bare alias (e.g.
// `claude-haiku-4-5`) 404s → the probe silently degrades to "detected · request
// failed" and the picker shows UNKNOWN. Pin the suffixed id the API resolves for
// the PROBE only; the selectable Haiku id is the bare alias (see below).
const PROBE_MODEL = 'claude-haiku-4-5-20251001';
// contextTokens is the STANDARD size; the 1M variant lives in contextOptions.
const MODELS: ModelInfo[] = [
  { id: 'claude-fable-5',    label: 'Fable 5',    defaultTier: 'paid', contextTokens: 200_000, contextOptions: STD_OR_1M },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',   defaultTier: 'paid', contextTokens: 200_000, contextOptions: STD_OR_1M },
  { id: 'claude-opus-4-7',   label: 'Opus 4.7',   defaultTier: 'paid', contextTokens: 200_000, contextOptions: STD_OR_1M },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', defaultTier: 'paid', contextTokens: 200_000, contextOptions: STD_OR_1M },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',  defaultTier: 'paid', contextTokens: 200_000, contextOptions: STD_ONLY },
];

const resolveKey = makeKeyResolver('anthropic', () => import.meta.env.VITE_ANTHROPIC_API_KEY);

// ─── Adapters between neutral and Anthropic shapes ────────────────────────

type AnthropicContent = Anthropic.MessageParam['content'];

function toAnthropicMessages(msgs: NeutralMessage[]): Anthropic.MessageParam[] {
  const out = msgs.map((m) => ({ role: m.role, content: toAnthropicContent(m.content, m.attachments) }));
  // Prompt-caching hygiene: mark the end of the SECOND-TO-LAST user message as
  // a cache breakpoint. Everything up to it is a stable prefix across turns
  // (system prompt has its own breakpoint), so each new turn re-reads the
  // conversation at cache-read prices instead of full input price.
  const userIdxs = out.reduce<number[]>((acc, m, i) => (m.role === 'user' ? [...acc, i] : acc), []);
  const anchor = userIdxs.length >= 2 ? userIdxs[userIdxs.length - 2] : -1;
  if (anchor >= 0 && Array.isArray(out[anchor].content)) {
    const blocks = out[anchor].content as unknown as Array<Record<string, unknown>>;
    const last = blocks[blocks.length - 1];
    if (last && (last.type === 'text' || last.type === 'tool_result')) {
      last.cache_control = { type: 'ephemeral' };
    }
  }
  return out;
}

function toAnthropicContent(items: NeutralContent[], attachments?: NeutralAttachment[]): AnthropicContent {
  const blocks: unknown[] = [];
  // Attachments lead the message (image/document blocks), text follows. Only
  // in-memory attachments (with base64) are sendable — persisted metadata-only
  // ones from a previous app run are skipped.
  for (const a of attachments ?? []) {
    if (!a.base64) continue;
    if (a.kind === 'image') {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.base64 } });
    } else if (a.mime === 'application/pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } });
    }
  }
  for (const c of items) {
    switch (c.type) {
      case 'text': blocks.push({ type: 'text', text: c.text }); break;
      case 'tool_use': blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input }); break;
      case 'tool_result':
        blocks.push({ type: 'tool_result', tool_use_id: c.toolUseId, content: c.content, is_error: c.isError ?? false });
        break;
      // Thinking blocks aren't part of the API request surface — they only appear
      // in responses. Round-tripping them from prior turns is the model's job.
      case 'thinking': blocks.push({ type: 'text', text: '' }); break;
    }
  }
  return blocks as unknown as AnthropicContent;
}

function fromAnthropicMessage(msg: Anthropic.Message): NeutralResponse {
  const content: NeutralContent[] = msg.content.map((b) => {
    if (b.type === 'text') return { type: 'text', text: b.text };
    if (b.type === 'thinking') return { type: 'thinking', text: b.thinking };
    if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> };
    return { type: 'text', text: '' };
  });
  const stopReason: NeutralStopReason =
    msg.stop_reason === 'tool_use' ? 'tool_use'
    : msg.stop_reason === 'max_tokens' ? 'max_tokens'
    : msg.stop_reason === 'refusal' ? 'refusal'
    : msg.stop_reason === 'pause_turn' ? 'pause'
    : 'end_turn';
  const u = msg.usage as unknown as {
    input_tokens?: number; output_tokens?: number;
    cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
  };
  const usage: NeutralUsage = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    total: (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
      + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
  };
  return { content, stopReason, usage, providerModel: msg.model };
}

// ─── Transport implementation ─────────────────────────────────────────────

type StreamParams = Parameters<Anthropic['messages']['stream']>[0];

class AnthropicTransport implements AgentTransport {
  readonly id = 'anthropic';
  constructor(readonly modelId: string, private client: Anthropic, readonly contextSize: ContextSizeId = 'standard') {}

  async createMessage(req: AgentRequest, cbs: StreamCallbacks): Promise<NeutralResponse> {
    const body = {
      model: this.modelId,
      max_tokens: req.maxTokens,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: toAnthropicMessages(req.messages),
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
      output_config: { effort: req.effort },
      ...(req.thinking ? { thinking: { type: 'adaptive' } } : {}),
    };

    const stream = this.client.messages.stream(
      body as unknown as StreamParams,
      req.signal ? { signal: req.signal } : undefined,
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') cbs.onText?.(event.delta.text);
        else if (event.delta.type === 'thinking_delta') cbs.onThinking?.(event.delta.thinking);
      }
    }
    return fromAnthropicMessage(await stream.finalMessage());
  }
}

// ─── Provider ────────────────────────────────────────────────────────────

import type { NeutralAttachment, NeutralMessage } from '../transport';

export const anthropicProvider: Provider = {
  id: 'anthropic',
  label: 'Claude',
  description: 'Anthropic Claude — Fable 5, Opus, Sonnet, Haiku.',
  models: () => MODELS,

  async probe(): Promise<ProbeResult> {
    return probeWithKey(resolveKey, 'ANTHROPIC_API_KEY not set', async (key) => {
      // A tiny count_tokens probe: cheap, exposes rate-limit headers.
      const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
      const resp = await client.messages.countTokens({
        model: PROBE_MODEL,
        messages: [{ role: 'user', content: 'hi' }],
      });
      // If we can count tokens, the key is live. Anthropic doesn't cleanly expose
      // tier via the SDK — call it "paid" (developer key). Free tier = console-only.
      return { tier: 'paid', label: `key ok · ${resp.input_tokens ?? '?'} tok probe` };
    });
  },

  async createTransport(modelId: string, context: ContextSizeId = 'standard'): Promise<AgentTransport> {
    const key = await resolveKey();
    if (!key) throw new Error('Anthropic API key not found. Set ANTHROPIC_API_KEY.');
    // The 1M-context header is defensive/legacy: current models (Opus 4.8/4.7,
    // Sonnet 4.6, Fable 5) serve 1M at standard pricing on the direct API, so
    // this is effectively a no-op there. The context toggle here is mostly
    // informational — the header just makes the intent explicit.
    const client = new Anthropic({
      apiKey: key,
      dangerouslyAllowBrowser: true,
      ...(context === '1m' ? { defaultHeaders: { 'anthropic-beta': 'context-1m-2025-08-07' } } : {}),
    });
    return new AnthropicTransport(modelId, client, context);
  },
};
