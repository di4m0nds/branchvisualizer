// ─── Agent transport hook ────────────────────────────────────────────────────
// Owns the per-panel transport cache that ChatPanel used to keep inline in a
// ref. A transport is reused across turns while the provider + model +
// context-size selection is unchanged; any change in that triple invalidates
// the cache and a fresh transport is built through the provider registry.

import { useCallback, useRef } from 'react';
import type { AgentTransport, ContextSizeId } from '@/lib/agent/transport';
import { createTransportFor } from '@/lib/agent/providers';

export function useAgentTransport() {
  const transportRef = useRef<AgentTransport | null>(null);

  // Stable identity (empty deps) so callers can hold it across renders without
  // re-wiring streaming callbacks. Cache key: provider id + model id +
  // context-size variant (absent contextSize on a cached transport counts as
  // 'standard', matching the pre-extraction semantics).
  const getTransport = useCallback(
    async (providerId: string, modelId: string, context?: ContextSizeId): Promise<AgentTransport> => {
      const ctx = context ?? 'standard';
      const cached = transportRef.current;
      if (
        cached
        && cached.id === providerId
        && cached.modelId === modelId
        && (cached.contextSize ?? 'standard') === ctx
      ) {
        return cached;
      }
      const fresh = await createTransportFor(providerId, modelId, ctx);
      transportRef.current = fresh;
      return fresh;
    },
    [],
  );

  return { getTransport };
}
