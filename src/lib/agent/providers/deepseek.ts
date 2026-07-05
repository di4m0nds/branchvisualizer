// DeepSeek — OpenAI-compatible API at api.deepseek.com. `deepseek-reasoner`
// streams reasoning via `reasoning_content` deltas (mapped to thinking).

import { makeOpenAiCompatibleProvider } from './openaiCompatible';
import type { ModelInfo } from '../transport';

const MODELS: ModelInfo[] = [
  { id: 'deepseek-chat', label: 'DeepSeek Chat (V3.2)', defaultTier: 'paid', contextTokens: 128_000 },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)', defaultTier: 'paid', contextTokens: 128_000 },
];

export const deepseekProvider = makeOpenAiCompatibleProvider({
  id: 'deepseek',
  label: 'DeepSeek',
  description: 'DeepSeek chat + reasoner via the OpenAI-compatible API.',
  baseUrl: 'https://api.deepseek.com/v1',
  staticModels: MODELS,
  keyName: 'deepseek',
  viteEnv: () => import.meta.env.VITE_DEEPSEEK_API_KEY,
  missingKeyLabel: 'DEEPSEEK_API_KEY not set',
});
