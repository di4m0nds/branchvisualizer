// xAI Grok — OpenAI-compatible API at api.x.ai.

import { makeOpenAiCompatibleProvider } from './openaiCompatible';
import type { ModelInfo } from '../transport';

const MODELS: ModelInfo[] = [
  { id: 'grok-4', label: 'Grok 4', defaultTier: 'paid', contextTokens: 256_000 },
  { id: 'grok-4-fast', label: 'Grok 4 Fast', defaultTier: 'paid', contextTokens: 2_000_000 },
  { id: 'grok-3', label: 'Grok 3', defaultTier: 'paid', contextTokens: 131_072 },
  { id: 'grok-3-mini', label: 'Grok 3 Mini', defaultTier: 'paid', contextTokens: 131_072 },
];

export const xaiProvider = makeOpenAiCompatibleProvider({
  id: 'xai',
  label: 'xAI',
  description: 'Grok models via the OpenAI-compatible xAI API.',
  baseUrl: 'https://api.x.ai/v1',
  staticModels: MODELS,
  keyName: 'xai',
  viteEnv: () => import.meta.env.VITE_XAI_API_KEY,
  missingKeyLabel: 'XAI_API_KEY not set',
});
