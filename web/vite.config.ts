/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local only: both servers bind to 127.0.0.1. The draft API (make draft-api) runs on 8765;
// the app calls relative /api/... and the dev server strips the prefix.
// `pnpm build:demo` (--mode demo): a standalone, offline prototype for GitHub Pages under
// /app/. Relative base (hash routing), its own outDir, and VITE_DEMO=1 switches the API
// layer to the demo transport (src/api/demoTransport.ts): no network requests at all.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  ...(mode === 'demo'
    ? { base: './', define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') } }
    : {}),
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  // Local-only app served from 127.0.0.1: one ~900 kB bundle is fine, no code splitting needed.
  build: { chunkSizeWarningLimit: mode === 'demo' ? 1600 : 1200, ...(mode === 'demo' ? { outDir: 'dist-demo', emptyOutDir: true } : {}) },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
}));
