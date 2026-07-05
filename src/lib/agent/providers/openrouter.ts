// OpenRouter — one key, hundreds of models across every lab, via the
// OpenAI-compatible dialect. The probe fetches the live model list (capped)
// so the picker shows what the account can actually reach.

import { makeOpenAiCompatibleProvider } from './openaiCompatible';
import type { ModelInfo } from '../transport';

const BASE_URL = 'https://openrouter.ai/api/v1';
const DYNAMIC_MODEL_CAP = 60;

// Static fallback (shown until the first successful probe fills the live list).
const STATIC_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', defaultTier: 'paid', contextTokens: 200_000 },
  { id: 'openai/gpt-5.1', label: 'GPT-5.1', defaultTier: 'paid', contextTokens: 400_000 },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', defaultTier: 'paid', contextTokens: 1_000_000 },
  { id: 'deepseek/deepseek-chat-v3.1', label: 'DeepSeek V3.1', defaultTier: 'paid', contextTokens: 128_000 },
  { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', defaultTier: 'paid', contextTokens: 1_000_000 },
];

export const openrouterProvider = makeOpenAiCompatibleProvider({
  id: 'openrouter',
  label: 'OpenRouter',
  description: 'Hundreds of models from every provider behind one key (OpenAI-compatible).',
  baseUrl: BASE_URL,
  staticModels: STATIC_MODELS,
  keyName: 'openrouter',
  viteEnv: () => import.meta.env.VITE_OPENROUTER_API_KEY,
  missingKeyLabel: 'OPENROUTER_API_KEY not set',
  headers: {
    // OpenRouter attribution headers (optional but recommended).
    'HTTP-Referer': 'https://github.com/di4m0nds/code-agent',
    'X-Title': 'code-agent',
  },
  async listModels(key, baseUrl) {
    const res = await fetch(`${baseUrl}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ id: string; name?: string; context_length?: number }> };
    if (!Array.isArray(json.data)) return null;
    const models = json.data
      .map((m): ModelInfo => ({
        id: m.id,
        label: m.name ?? m.id,
        defaultTier: 'paid',
        contextTokens: m.context_length,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    // Keep the curated favorites on top, then the live list (capped so the
    // picker stays scrollable).
    const favoriteIds = new Set(STATIC_MODELS.map((m) => m.id));
    const favorites = models.filter((m) => favoriteIds.has(m.id));
    const rest = models.filter((m) => !favoriteIds.has(m.id)).slice(0, DYNAMIC_MODEL_CAP);
    return [...(favorites.length ? favorites : STATIC_MODELS), ...rest];
  },
});
