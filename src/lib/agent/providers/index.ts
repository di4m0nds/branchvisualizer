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

/** Build a transport for the user's selected provider+model+context. */
export async function createTransportFor(providerId: string, modelId: string, context?: ContextSizeId) {
  const p = findProvider(providerId);
  if (!p) throw new Error(`Unknown provider: ${providerId}`);
  return p.createTransport(modelId, context);
}
