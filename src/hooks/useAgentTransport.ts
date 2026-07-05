// ─── Agent transport hook ────────────────────────────────────────────────────
// Owns the per-panel transport cache that ChatPanel used to keep inline in a
// ref. A transport is reused across turns while the provider + model +
// context-size selection is unchanged; any change in that triple invalidates
// the cache and a fresh transport is built through the provider registry.

import { useCallback, useRef } from 'react';
import type { AgentTransport, ContextSizeId } from '@/lib/agent/transport';
import { createTransportFor } from '@/lib/agent/providers';

/** With per-session models, panels alternate between sessions on different
 *  provider/model triples — a single-slot cache would rebuild the transport on
 *  every switch. Keep a small LRU keyed by the triple instead (transports are
 *  stateless per-request, so sharing an identical triple across sessions is
 *  safe). */
const CACHE_MAX = 8;

export function useAgentTransport() {
  const cacheRef = useRef<Map<string, AgentTransport>>(new Map());

  // Stable identity (empty deps) so callers can hold it across renders without
  // re-wiring streaming callbacks. Cache key: provider id + model id +
  // context-size variant.
  const getTransport = useCallback(
    async (providerId: string, modelId: string, context?: ContextSizeId): Promise<AgentTransport> => {
      const ctx = context ?? 'standard';
      const key = `${providerId}:${modelId}:${ctx}`;
      const cache = cacheRef.current;
      const cached = cache.get(key);
      if (cached) {
        // LRU touch: re-insert so eviction drops the coldest entry.
        cache.delete(key);
        cache.set(key, cached);
        return cached;
      }
      const fresh = await createTransportFor(providerId, modelId, ctx);
      cache.set(key, fresh);
      if (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return fresh;
    },
    [],
  );

  return { getTransport };
}
