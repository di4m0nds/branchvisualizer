import Anthropic from '@anthropic-ai/sdk';
import { invoke, isTauri } from '../../platform';
import type {
  AgentRequest, AgentTransport, ModelInfo, NeutralContent, NeutralResponse,
  NeutralStopReason, NeutralUsage, ProbeResult, Provider, StreamCallbacks,
} from '../transport';

const MODELS: ModelInfo[] = [
  { id: 'claude-fable-5',    label: 'Fable 5',    defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',   defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'claude-opus-4-7',   label: 'Opus 4.7',   defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',  defaultTier: 'paid', contextTokens: 200_000 },
];

async function resolveKey(): Promise<string | null> {
  if (isTauri()) {
    const k = await invoke<string | null>('get_provider_key', { name: 'anthropic' }).catch(() => null);
    if (k) return k;
  }
  return import.meta.env.VITE_ANTHROPIC_API_KEY ?? null;
}

// ─── Adapters between neutral and Anthropic shapes ────────────────────────

type AnthropicContent = Anthropic.MessageParam['content'];

function toAnthropicMessages(msgs: NeutralMessage[]): Anthropic.MessageParam[] {
  return msgs.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) }));
}

function toAnthropicContent(items: NeutralContent[]): AnthropicContent {
  return items.map((c) => {
    switch (c.type) {
      case 'text': return { type: 'text', text: c.text } as const;
      case 'tool_use': return { type: 'tool_use', id: c.id, name: c.name, input: c.input } as const;
      case 'tool_result': return {
        type: 'tool_result', tool_use_id: c.toolUseId, content: c.content, is_error: c.isError ?? false,
      } as const;
      // Thinking blocks aren't part of the API request surface — they only appear
      // in responses. Round-tripping them from prior turns is the model's job.
      case 'thinking': return { type: 'text', text: '' } as const;
    }
  }) as unknown as AnthropicContent;
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
  constructor(readonly modelId: string, private client: Anthropic) {}

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

    const stream = this.client.messages.stream(body as unknown as StreamParams);

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

import type { NeutralMessage } from '../transport';

export const anthropicProvider: Provider = {
  id: 'anthropic',
  label: 'Claude',
  description: 'Anthropic Claude — Fable 5, Opus, Sonnet, Haiku.',
  models: () => MODELS,

  async probe(): Promise<ProbeResult> {
    const key = await resolveKey();
    if (!key) return { state: 'not_detected', tier: 'unknown', label: 'ANTHROPIC_API_KEY not set' };
    try {
      // A tiny count_tokens probe: cheap, exposes rate-limit headers.
      const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
      const resp = await client.messages.countTokens({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'hi' }],
      });
      // If we can count tokens, the key is live. Anthropic doesn't cleanly expose
      // tier via the SDK — call it "paid" (developer key). Free tier = console-only.
      return { state: 'connected', tier: 'paid', label: `key ok · ${resp.input_tokens ?? '?'} tok probe` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { state: 'detected', tier: 'unknown', label: 'key present but request failed', error: msg };
    }
  },

  async createTransport(modelId: string): Promise<AgentTransport> {
    const key = await resolveKey();
    if (!key) throw new Error('Anthropic API key not found. Set ANTHROPIC_API_KEY.');
    return new AnthropicTransport(modelId, new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }));
  },
};
