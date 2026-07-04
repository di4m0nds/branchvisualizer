import type { ContextSizeId, Provider } from '../transport';
import { anthropicProvider } from './anthropic';
import { claudeCodeProvider } from './claude_code';
import { openaiCodexProvider } from './openai_codex';
import { geminiProvider } from './gemini';
import { antigravityProvider } from './antigravity';
import { minimaxProvider } from './minimax';
import { opencodeProvider } from './opencode';

export const PROVIDERS: Provider[] = [
  anthropicProvider,
  claudeCodeProvider,
  openaiCodexProvider,
  geminiProvider,
  antigravityProvider,
  minimaxProvider,
  opencodeProvider,
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
};

export function attachmentSupportFor(providerId: string): AttachmentSupport {
  return ATTACHMENT_SUPPORT[providerId] ?? { image: false, pdf: false };
}

/** Build a transport for the user's selected provider+model+context. */
export async function createTransportFor(providerId: string, modelId: string, context?: ContextSizeId) {
  const p = findProvider(providerId);
  if (!p) throw new Error(`Unknown provider: ${providerId}`);
  return p.createTransport(modelId, context);
}
