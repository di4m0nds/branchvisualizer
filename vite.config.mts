import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        // Split heavy, independent vendor libraries into their own chunks so
        // they cache separately and load in parallel (order: specific → general).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@anthropic-ai')) return 'vendor-anthropic';
          if (id.includes('@google/genai')) return 'vendor-genai';
          if (id.includes('/openai/')) return 'vendor-openai';
          if (id.includes('xterm')) return 'vendor-xterm';
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
          if (id.includes('mammoth')) return 'vendor-mammoth';
          if (
            id.includes('react-markdown') || id.includes('remark') ||
            id.includes('micromark') || id.includes('mdast') ||
            id.includes('prism-react-renderer')
          ) return 'vendor-markdown';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
