// Phase 4+5 — Capability hook.
// VITE_USE_BACKEND=true  → fetches /auth/me from backend
// VITE_USE_BACKEND=false → derives from local state.token (no backend call)
import { useCallback } from 'react';
import { useAppContext } from '@/store/AppContext';
import type { Capability, CapabilityState } from '@/types';

const USE_BACKEND = import.meta.env.VITE_USE_BACKEND === 'true';
const API_URL =
  ((import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')) ??
  'http://localhost:3001';

interface AuthMeResponse {
  authenticated: boolean;
  login: string | null;
  capabilities: Capability[];
  backendTokenConfigured: boolean;
}

export interface UseCapabilitiesResult extends CapabilityState {
  hasCapability: (cap: Capability) => boolean;
  refresh: () => Promise<void>;
}

export function useCapabilities(): UseCapabilitiesResult {
  const { state, dispatch } = useAppContext();

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

  // Non-backend: derive from local token
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

  // Backend: read from AppState
  const { capabilityState } = state;
  return {
    ...capabilityState,
    hasCapability: (cap: Capability) => capabilityState.capabilities.includes(cap),
    refresh,
  };
}
