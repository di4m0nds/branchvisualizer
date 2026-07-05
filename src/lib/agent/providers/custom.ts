// ─── User-defined OpenAI-compatible endpoints ───────────────────────────────
// Custom providers (LM Studio, vLLM, LiteLLM proxies, corporate gateways, …)
// described in localStorage and materialized through the shared factory.
// Edited in Settings → Providers; changes apply on next app load (the registry
// is assembled at module init).

import { makeOpenAiCompatibleProvider } from './openaiCompatible';
import type { ModelInfo, Provider } from '../transport';
import { swallow } from '../../log';

const KEY = 'code-agent:custom_providers';

export interface CustomProviderSpec {
  /** Unique id, prefixed `custom_` at creation time to avoid collisions. */
  id: string;
  label: string;
  /** Base URL without trailing slash, e.g. `http://localhost:1234/v1`. */
  baseUrl: string;
  /** Model ids the endpoint serves (comma-entered in Settings). */
  modelIds: string[];
  /** When true, a key is required; stored under the provider's own id via the
   *  standard provider-key mechanism (keychain / localStorage). */
  requiresKey?: boolean;
}

export function loadCustomProviderSpecs(): CustomProviderSpec[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as CustomProviderSpec[]).filter(
      (s) => s && typeof s.id === 'string' && typeof s.baseUrl === 'string' && Array.isArray(s.modelIds),
    );
  } catch (e) {
    swallow('providers', 'load custom providers')(e);
    return [];
  }
}

export function saveCustomProviderSpecs(specs: CustomProviderSpec[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(specs));
  } catch (e) {
    swallow('providers', 'persist custom providers')(e);
  }
}

export function customProviders(): Provider[] {
  return loadCustomProviderSpecs().map((spec) => {
    const models: ModelInfo[] = spec.modelIds
      .filter((id) => id.trim().length > 0)
      .map((id) => ({ id: id.trim(), label: id.trim(), defaultTier: 'unknown' as const }));
    return makeOpenAiCompatibleProvider({
      id: spec.id,
      label: spec.label || spec.id,
      description: `Custom OpenAI-compatible endpoint · ${spec.baseUrl}`,
      baseUrl: spec.baseUrl.replace(/\/+$/, ''),
      staticModels: models.length ? models : [{ id: 'default', label: 'default' }],
      ...(spec.requiresKey ? { keyName: spec.id, missingKeyLabel: 'API key not set (Settings → Providers)' } : {}),
    });
  });
}
