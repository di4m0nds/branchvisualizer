import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AppProvider } from './store/AppContext.tsx';
import { cachePrune } from './lib/cache.ts';

// Prune stale cache entries on startup
cachePrune();

const root = document.getElementById('root')!;
createRoot(root).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
