// Ollama — local models through the OpenAI-compatible endpoint at
// localhost:11434/v1. Keyless; the probe hits the native /api/tags route to
// detect the daemon AND fill the model list with what's actually pulled.

import { makeOpenAiCompatibleProvider } from './openaiCompatible';
import type { ModelInfo } from '../transport';

const NATIVE_URL = 'http://localhost:11434';

// Placeholder until the daemon is probed (models() must return something).
const STATIC_MODELS: ModelInfo[] = [
  { id: 'llama3.1', label: 'Llama 3.1 (pull first)', defaultTier: 'free' },
];

async function listLocalModels(): Promise<ModelInfo[] | null> {
  const res = await fetch(`${NATIVE_URL}/api/tags`);
  if (!res.ok) return null;
  const json = (await res.json()) as { models?: Array<{ name: string }> };
  if (!Array.isArray(json.models) || json.models.length === 0) return null;
  return json.models.map((m) => ({ id: m.name, label: m.name, defaultTier: 'free' as const }));
}

export const ollamaProvider = makeOpenAiCompatibleProvider({
  id: 'ollama',
  label: 'Ollama',
  description: 'Local models via the Ollama daemon (localhost:11434). Free, private, offline.',
  baseUrl: `${NATIVE_URL}/v1`,
  staticModels: STATIC_MODELS,
  // Keyless — probe failure = daemon not running (not_detected, no warning).
  async ping() {
    const res = await fetch(`${NATIVE_URL}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    const n = json.models?.length ?? 0;
    return { tier: 'free' as const, label: n ? `${n} local model${n === 1 ? '' : 's'}` : 'daemon up · no models pulled' };
  },
  listModels: () => listLocalModels(),
});
