import type { ContextSizeId, Provider } from '../transport';
import { anthropicProvider } from './anthropic';
import { claudeCodeProvider } from './claude_code';
import { openaiCodexProvider } from './openai_codex';
import { geminiProvider } from './gemini';
import { antigravityProvider } from './antigravity';
import { minimaxProvider } from './minimax';
import { opencodeProvider } from './opencode';
import { openrouterProvider } from './openrouter';
import { xaiProvider } from './xai';
import { deepseekProvider } from './deepseek';
import { ollamaProvider } from './ollama';
import { customProviders } from './custom';

export const PROVIDERS: Provider[] = [
  anthropicProvider,
  claudeCodeProvider,
  openaiCodexProvider,
  geminiProvider,
  antigravityProvider,
  minimaxProvider,
  opencodeProvider,
  openrouterProvider,
  xaiProvider,
  deepseekProvider,
  ollamaProvider,
  // User-defined OpenAI-compatible endpoints (Settings → Providers); the list
  // is assembled at module init, so edits apply on next app load.
  ...customProviders(),
];

export function findProvider(id: string): Provider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

// ─── Attachment capabilities ─────────────────────────────────────────────────
// What each provider's transport can accept from the chat composer. Video is
// deferred. `pathPassthrough` = the provider runs locally and reads files
// itself (Claude Code CLI), so any file type works via its absolute path.

export interface AttachmentSupport {
  image: boolean;
  pdf: boolean;
  pathPassthrough?: boolean;
}

export const ATTACHMENT_SUPPORT: Record<string, AttachmentSupport> = {
  anthropic: { image: true, pdf: true },
  gemini: { image: true, pdf: true },
  antigravity: { image: false, pdf: false },
  openai_codex: { image: true, pdf: false },
  claude_code: { image: true, pdf: true, pathPassthrough: true },
  minimax: { image: false, pdf: false },
  opencode: { image: false, pdf: false },
  openrouter: { image: false, pdf: false },
  xai: { image: false, pdf: false },
  deepseek: { image: false, pdf: false },
  ollama: { image: false, pdf: false },
};

export function attachmentSupportFor(providerId: string): AttachmentSupport {
  return ATTACHMENT_SUPPORT[providerId] ?? { image: false, pdf: false };
}

/** Downgrade a requested context id to 'standard' when the resolved model
 *  doesn't expose it — e.g. a session persisted a `1m` pick on a model that has
 *  since been restricted to 200K (Opus). Pure, so it's unit-testable without a
 *  live transport. */
export function clampContext(providerId: string, modelId: string, context?: ContextSizeId): ContextSizeId {
  const ctx = context ?? 'standard';
  if (ctx === 'standard') return 'standard';
  const model = findProvider(providerId)?.models().find((m) => m.id === modelId);
  const opts = model?.contextOptions ?? [];
  return opts.some((o) => o.id === ctx) ? ctx : 'standard';
}

/** Build a transport for the user's selected provider+model+context. */
export async function createTransportFor(providerId: string, modelId: string, context?: ContextSizeId) {
  const p = findProvider(providerId);
  if (!p) throw new Error(`Unknown provider: ${providerId}`);
  return p.createTransport(modelId, clampContext(providerId, modelId, context));
}
