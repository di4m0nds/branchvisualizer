import type { Provider } from '../transport';
import { anthropicProvider } from './anthropic';
import { openaiCodexProvider } from './openai_codex';
import { geminiProvider } from './gemini';
import { minimaxProvider } from './minimax';
import { opencodeProvider } from './opencode';

export const PROVIDERS: Provider[] = [
  anthropicProvider,
  openaiCodexProvider,
  geminiProvider,
  minimaxProvider,
  opencodeProvider,
];

export function findProvider(id: string): Provider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Build a transport for the user's selected provider+model. */
export async function createTransportFor(providerId: string, modelId: string) {
  const p = findProvider(providerId);
  if (!p) throw new Error(`Unknown provider: ${providerId}`);
  return p.createTransport(modelId);
}
