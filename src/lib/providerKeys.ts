// ─── Manual provider API keys ────────────────────────────────────────────────
// User-entered keys for providers the app can't auto-detect. On desktop they go
// to the OS keychain (Tauri `*_secure_key` commands); in the browser build they
// fall back to localStorage. Provider transports consult these FIRST in their
// `resolveKey()`, before env vars.

import { invoke, isTauri } from './platform';
import { log, swallow } from './log';

const LS_KEY = 'code-agent:provider_keys';

function readLs(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    swallow('providerKeys', 'read localStorage keys')(e);
    return {};
  }
}

function writeLs(map: Record<string, string>): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch (e) { swallow('providerKeys', 'persist (quota)')(e); }
}

/** Resolve a manually-stored key for `provider`, or null. Desktop → keychain. */
export async function getProviderKey(provider: string): Promise<string | null> {
  if (isTauri()) {
    const k = await invoke<string | null>('get_secure_key', { provider }).catch((e) => { swallow('providerKeys', `keychain read ${provider}`)(e); return null; });
    if (k) return k;
  }
  return readLs()[provider] ?? null;
}

/** Store (empty string clears) a provider key. Desktop → keychain, web → LS. */
export async function setProviderKey(provider: string, key: string): Promise<void> {
  if (isTauri()) {
    await invoke('set_secure_key', { provider, key }).catch((e) => log.warn('providerKeys', `keychain write failed for ${provider} — key NOT saved`, e));
    return;
  }
  const map = readLs();
  if (key) map[provider] = key;
  else delete map[provider];
  writeLs(map);
}

export async function deleteProviderKey(provider: string): Promise<void> {
  return setProviderKey(provider, '');
}

/** Sync check used by the browser build to show whether a key is set. */
export function hasLocalProviderKey(provider: string): boolean {
  return !!readLs()[provider];
}
