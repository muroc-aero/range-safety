import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The SPA is served by the Starlette dashboard: index.html at "/" and hashed
// assets under "/static/spa/". `base` must match the static mount so asset
// URLs resolve in production. The build writes into the Python package's
// static dir so the bundle ships with the wheel / image.
//
// In dev, `vite` serves index.html itself and proxies the read-model API
// (and the matplotlib PNG endpoints) to a locally-running uvicorn instance.
const BACKEND = process.env.RS_DASHBOARD_BACKEND ?? 'http://127.0.0.1:8000';

export default defineConfig({
  base: '/static/spa/',
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    outDir: resolve(__dirname, '../src/hangar/range_safety/dashboard/static/spa'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
    },
  },
});
