// ─── Approximate model pricing ───────────────────────────────────────────────
// Static $/MTok table for cost telemetry. APPROXIMATE by design — providers
// change prices and add models; unknown models fall back to a conservative
// family guess or null. Display always says "≈".

export interface ModelPrice {
  /** USD per million input tokens. */
  inPerM: number;
  /** USD per million output tokens. */
  outPerM: number;
}

// Known models (exact-id match first, then substring family fallback).
const PRICES: Record<string, ModelPrice> = {
  // Anthropic
  'claude-fable-5': { inPerM: 25, outPerM: 125 },
  'claude-opus-4-8': { inPerM: 15, outPerM: 75 },
  'claude-opus-4-7': { inPerM: 15, outPerM: 75 },
  'claude-sonnet-5': { inPerM: 3, outPerM: 15 },
  'claude-sonnet-4-6': { inPerM: 3, outPerM: 15 },
  'claude-haiku-4-5': { inPerM: 1, outPerM: 5 },
  // Claude Code aliases
  opus: { inPerM: 15, outPerM: 75 },
  sonnet: { inPerM: 3, outPerM: 15 },
  haiku: { inPerM: 1, outPerM: 5 },
  // OpenAI
  'gpt-5.1-codex': { inPerM: 1.25, outPerM: 10 },
  'gpt-5-codex': { inPerM: 1.25, outPerM: 10 },
  'gpt-4.1': { inPerM: 2, outPerM: 8 },
  'o4-mini': { inPerM: 1.1, outPerM: 4.4 },
  // Google
  'gemini-2.5-pro': { inPerM: 1.25, outPerM: 10 },
  'gemini-2.5-flash': { inPerM: 0.3, outPerM: 2.5 },
  'gemini-2.5-flash-lite': { inPerM: 0.1, outPerM: 0.4 },
  // MiniMax
  'minimax-m2': { inPerM: 0.3, outPerM: 1.2 },
};

const FAMILY_FALLBACKS: Array<[RegExp, ModelPrice]> = [
  [/fable/i, PRICES['claude-fable-5']],
  [/opus/i, PRICES.opus],
  [/sonnet/i, PRICES.sonnet],
  [/haiku/i, PRICES.haiku],
  [/codex|gpt-5/i, PRICES['gpt-5-codex']],
  [/flash-lite/i, PRICES['gemini-2.5-flash-lite']],
  [/flash/i, PRICES['gemini-2.5-flash']],
  [/gemini/i, PRICES['gemini-2.5-pro']],
  [/minimax|abab/i, PRICES['minimax-m2']],
];

export function priceFor(modelId: string): ModelPrice | null {
  if (PRICES[modelId]) return PRICES[modelId];
  for (const [re, price] of FAMILY_FALLBACKS) {
    if (re.test(modelId)) return price;
  }
  return null;
}

export interface UsageLike {
  input: number;
  output: number;
  /** Model that served the turn (for accurate per-message pricing). */
  modelId?: string;
}

/** ≈ USD for one usage record. null when the model is unknown. */
export function estimateCost(usage: UsageLike, fallbackModelId?: string): number | null {
  const price = priceFor(usage.modelId ?? fallbackModelId ?? '');
  if (!price) return null;
  return (usage.input / 1e6) * price.inPerM + (usage.output / 1e6) * price.outPerM;
}

/** Aggregate ≈ USD for many usage records; null only when NONE were priceable. */
export function estimateTotalCost(usages: UsageLike[], fallbackModelId?: string): number | null {
  let total = 0;
  let any = false;
  for (const u of usages) {
    const c = estimateCost(u, fallbackModelId);
    if (c !== null) { total += c; any = true; }
  }
  return any ? total : null;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(usd < 1 ? 2 : 2)}`;
}
