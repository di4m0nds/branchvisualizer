import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import '@/styles/globals.css';
import App from './App.tsx';
import { AppProvider } from './store/AppContext.tsx';
import { AssistantProvider } from './store/assistantStore.tsx';
import { cachePrune } from './lib/cache.ts';
import ErrorBoundary from './components/ErrorBoundary.tsx';

// Configure Monaco loader to use local node_modules (avoids CDN dependency)
loader.config({ paths: { vs: '/node_modules/monaco-editor/min/vs' } });

// Define the CodeAtlas dark theme before any editor mounts
loader.init().then((monaco) => {
  monaco.editor.defineTheme('codeatlas-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background':              '#0d0d0f',
      'editor.foreground':              '#e2e8f0',
      'editor.lineHighlightBackground': '#1a1a1f',
      'editorLineNumber.foreground':    '#4a5568',
      'editorLineNumber.activeForeground': '#a0aec0',
      'editor.selectionBackground':     '#2d4a8a',
      'editorGutter.background':        '#0d0d0f',
      'editorWidget.background':        '#161618',
      'editorSuggestWidget.background': '#161618',
      'editorSuggestWidget.border':     '#2d2d35',
      'editorSuggestWidget.selectedBackground': '#1e3a6e',
    },
  });
}).catch(() => {/* ignore — theme will fall back to vs-dark */});

// Prune stale cache entries on startup
cachePrune();

const root = document.getElementById('root')!;
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <AssistantProvider>
          <App />
        </AssistantProvider>
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>,
);
