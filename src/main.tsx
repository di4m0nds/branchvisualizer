import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import App from './App.tsx';
import { AppProvider } from './store/AppContext.tsx';
import { cachePrune } from './lib/cache.ts';
import ErrorBoundary from './components/ErrorBoundary.tsx';

// Prune stale cache entries on startup
cachePrune();

const root = document.getElementById('root')!;
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>,
);
