import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server proxies /api to the Express server on port 8787.
// The Hyperframes preview server (port 4321) is iframed directly.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/media': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
  },
  plugins: [react()],
});
