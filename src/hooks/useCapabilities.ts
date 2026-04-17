// Phase 4 — Capability hook.
// Source of truth:
//   - VITE_USE_BACKEND=true  → fetches /auth/me from backend
//   - VITE_USE_BACKEND=false → derives from local state.token (UX only; no backend call)

import { useCallback } from 'react';
import { useAppContext } from '@/store/AppContext';
import type { Capability, CapabilityState } from '@/types';

const USE_BACKEND = import.meta.env.VITE_USE_BACKEND === 'true';
const API_URL =
  ((import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')) ??
  'http://localhost:3001';

/** Full capability response shape from GET /auth/me */
interface AuthMeResponse {
  authenticated: boolean;
  login: string | null;
  capabilities: Capability[];
  backendTokenConfigured: boolean;
}

export interface UseCapabilitiesResult extends CapabilityState {
  /** True if the user holds this specific capability. */
  hasCapability: (cap: Capability) => boolean;
  /**
   * Re-fetch /auth/me (backend mode) or recompute from token (direct mode).
   * Safe to call multiple times.
   */
  refresh: () => Promise<void>;
}

export function useCapabilities(): UseCapabilitiesResult {
  const { state, dispatch } = useAppContext();

  // Backend mode: refresh fetches /auth/me
  const refresh = useCallback(async () => {
    if (!USE_BACKEND) return;

    dispatch({
      type: 'SET_CAPABILITIES',
      payload: {
        capabilities: ['read:graph'],
        authenticated: false,
        login: null,
        backendTokenConfigured: false,
        loading: true,
      },
    });

    try {
      const res = await fetch(`${API_URL}/auth/me`, { credentials: 'include' });
      if (!res.ok) throw new Error(`/auth/me returned ${res.status}`);
      const data: AuthMeResponse = await res.json();
      dispatch({
        type: 'SET_CAPABILITIES',
        payload: {
          capabilities: data.capabilities ?? ['read:graph'],
          authenticated: data.authenticated ?? false,
          login: data.login ?? null,
          backendTokenConfigured: data.backendTokenConfigured ?? false,
          loading: false,
        },
      });
    } catch {
      // On error fall back to anonymous read:graph
      dispatch({
        type: 'SET_CAPABILITIES',
        payload: {
          capabilities: ['read:graph'],
          authenticated: false,
          login: null,
          backendTokenConfigured: false,
          loading: false,
        },
      });
    }
  }, [dispatch]);

  // ── Non-backend mode: derive from local token ─────────────────────────────
  if (!USE_BACKEND) {
    const hasTok = !!state.token;
    const caps: Capability[] = hasTok
      ? ['read:graph', 'read:files', 'compare:commits', 'ai:assist']
      : ['read:graph'];
    return {
      capabilities: caps,
      authenticated: false,
      login: null,
      backendTokenConfigured: false,
      loading: false,
      hasCapability: (cap: Capability) => caps.includes(cap),
      refresh,
    };
  }

  // ── Backend mode: read from AppState ─────────────────────────────────────
  const { capabilityState } = state;
  return {
    ...capabilityState,
    hasCapability: (cap: Capability) => capabilityState.capabilities.includes(cap),
    refresh,
  };
}
