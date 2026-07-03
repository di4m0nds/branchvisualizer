import type { ContextOption } from '../transport';

// Shared context-window options for the Claude model families, so the two
// Claude providers (`anthropic` direct API and `claude_code` CLI) don't drift
// on the standard/1M numbers. The model id lists stay provider-specific — the
// CLI intentionally offers family aliases (opus/sonnet/haiku) plus pinned ids,
// while the direct API uses API ids — but the context options are the same.

/** Standard 200K window — always the default, always plan-serviceable. */
export const CTX_STD: ContextOption = { id: 'standard', label: 'Standard · 200K', tokens: 200_000 };
/** 1M window — usage-credit gated on Claude Code subscriptions. */
export const CTX_1M: ContextOption = { id: '1m', label: '1M', tokens: 1_000_000 };

/** Models that only serve 200K (e.g. Haiku). */
export const STD_ONLY: ContextOption[] = [CTX_STD];
/** Models that can serve 200K (default) or 1M (Opus / Sonnet / Fable). */
export const STD_OR_1M: ContextOption[] = [CTX_STD, CTX_1M];
