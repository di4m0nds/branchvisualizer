// Source of truth moved to @codeatlas/github (Step 5).
// Do NOT add logic here. Changes go to packages/github/src/index.ts.
export * from '@codeatlas/github';

// Phase 3: backend proxy mode.
// When VITE_USE_BACKEND=true the frontend routes all API calls through
// apps/api (http://localhost:3001 by default).  The backend injects the
// GitHub token server-side so it never touches the browser.
//
// VITE_API_URL can override the backend base URL (e.g. for staging).
// The direct-fetch path (VITE_USE_BACKEND=false / unset) is unchanged.
import { setApiBase, setGqlEndpoint } from '@codeatlas/github';

if (import.meta.env.VITE_USE_BACKEND === 'true') {
  const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
    ?? 'http://localhost:3001';
  // All REST calls: /api/github/rest/<original-path>
  setApiBase(`${apiUrl}/api/github/rest`);
  // GraphQL calls: /api/github/graphql
  setGqlEndpoint(`${apiUrl}/api/github/graphql`);
}
