// Feature flag utility — reads Vite env vars at runtime.
// All AI features are gated behind VITE_FEATURE_AI_PHASE6.

export function isFeatureEnabled(flag: string): boolean {
  try {
    // Vite exposes import.meta.env; fall back to false in non-browser contexts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any).env ?? {};
    return env[flag] === 'true' || env[flag] === true;
  } catch {
    return false;
  }
}

export const AI_ENABLED = () => isFeatureEnabled('VITE_FEATURE_AI_PHASE6');
