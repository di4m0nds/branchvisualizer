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

  // refresh() pings /auth/me to pick up real OAuth sessions (future feature).
  // In the current token-field model it's a no-op unless VITE_USE_BACKEND=true
  // and the user has actually completed an OAuth flow.
  const refresh = useCallback(async () => {
    if (!USE_BACKEND) return;
    try {
      const headers: Record<string, string> = {};
      if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
      const res = await fetch(`${API_URL}/auth/me`, {
        credentials: 'include',
        headers,
      });
      if (!res.ok) return; // silently ignore — fall back to local token below
      const data: AuthMeResponse = await res.json();
      // Only update state if the backend reports a real OAuth session.
      if (data.authenticated) {
        dispatch({
          type: 'SET_CAPABILITIES',
          payload: {
            capabilities: data.capabilities ?? ['read:graph'],
            authenticated: true,
            login: data.login ?? null,
            backendTokenConfigured: data.backendTokenConfigured ?? false,
            loading: false,
          },
        });
      }
    } catch {
      // Ignore — capabilities are derived from state.token below.
    }
  }, [dispatch, state.token]);

  // Always derive capabilities from the local token set via the UI.
  // This covers both direct mode and backend-proxy mode:
  //   - No token  → anonymous GitHub free tier (60 req/h), read:graph only
  //   - Token set → 5000 req/h, all features unlocked
  const hasTok = !!state.token;
  const caps: Capability[] = hasTok
    ? ['read:graph', 'read:files', 'compare:commits', 'ai:assist']
    : ['read:graph'];

  // If a real OAuth session was detected by a previous refresh(), surface that
  // login info. Otherwise report unauthenticated (token ≠ OAuth session).
  const { capabilityState } = state;
  const authenticated = capabilityState.authenticated;
  const login = capabilityState.login;

  return {
    capabilities: caps,
    authenticated,
    login,
    backendTokenConfigured: hasTok,
    loading: false,
    hasCapability: (cap: Capability) => caps.includes(cap),
    refresh,
  };
}
