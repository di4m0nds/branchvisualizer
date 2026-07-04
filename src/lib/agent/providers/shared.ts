// ─── Shared provider plumbing ─────────────────────────────────────────────
// Key resolution and the common API-key probe skeleton, deduplicated from the
// key-based providers (anthropic / gemini / minimax / openai_codex /
// antigravity). CLI-probed providers (claude_code, opencode) don't use this.

import { invoke, isTauri } from '../../platform';
import { getProviderKey } from '../../providerKeys';
import { swallow } from '../../log';
import type { ConnectionTier, ProbeResult } from '../transport';

/**
 * Build a provider's `resolveKey()` with the standard precedence:
 *
 *   1. manually-stored key(s) via `getProviderKey` (keychain / localStorage)
 *   2. Tauri `get_provider_key` (CLI-derived keys, e.g. `codex auth token`)
 *   3. a `VITE_*` env var (dev builds)
 *
 * `viteEnv` is a thunk so each provider keeps a statically-analyzable
 * `import.meta.env.VITE_…` expression (Vite inlines these at build time; a
 * dynamic `import.meta.env[name]` lookup would silently break).
 *
 * `extraStoredNames` lets a provider fall back to another provider's stored
 * key (e.g. antigravity reuses the shared gemini key).
 */
export function makeKeyResolver(
  providerName: string,
  viteEnv?: () => string | undefined,
  extraStoredNames: string[] = [],
): () => Promise<string | null> {
  return async () => {
    for (const name of [providerName, ...extraStoredNames]) {
      const stored = await getProviderKey(name);
      if (stored) return stored;
    }
    if (isTauri()) {
      const k = await invoke<string | null>('get_provider_key', { name: providerName })
        .catch((e) => { swallow('providers', `get_provider_key ${providerName}`)(e); return null; });
      if (k) return k;
    }
    return viteEnv?.() ?? null;
  };
}

/**
 * The common API-key probe skeleton: no key → `not_detected`; otherwise run
 * the provider-specific `ping(key)` (a cheap live request) and map success to
 * `connected` and any thrown error to `detected` ("key present but request
 * failed"). Providers whose probes check a CLI/SDK first don't fit this shape
 * and keep their own logic.
 */
export async function probeWithKey(
  resolveKey: () => Promise<string | null>,
  missingKeyLabel: string,
  ping: (key: string) => Promise<{ tier: ConnectionTier; label: string }>,
): Promise<ProbeResult> {
  const key = await resolveKey();
  if (!key) return { state: 'not_detected', tier: 'unknown', label: missingKeyLabel };
  try {
    const { tier, label } = await ping(key);
    return { state: 'connected', tier, label };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { state: 'detected', tier: 'unknown', label: 'key present but request failed', error: msg };
  }
}
