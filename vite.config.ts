import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';

// Bassmaster Workbench — Vite config (replaces CRA + craco)
//
// Two distribution targets share this config:
//   • Electron desktop  → base = './' (relative paths, file://)
//   • GH Pages web      → base = '/bassmaster/' (subpath deploy under
//                                  https://steti321-dot.github.io/bassmaster/)
//
// REACT_APP_BUILD_TARGET=web (set by `npm run build:web`) selects the web base.
//
// REACT_APP_* variables are kept verbatim in the source via the `define` block,
// so we don't have to find/replace every `process.env.REACT_APP_…` reference.

const isWebBuild = process.env.REACT_APP_BUILD_TARGET === 'web';

export default defineConfig({
  plugins: [react(), alphaTab()],
  base: isWebBuild ? '/bassmaster/' : './',
  define: {
    'process.env.REACT_APP_BUILD_TARGET': JSON.stringify(
      process.env.REACT_APP_BUILD_TARGET || '',
    ),
    'process.env.REACT_APP_PROXY_BASE': JSON.stringify(
      process.env.REACT_APP_PROXY_BASE || '',
    ),
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || 'development',
    ),
  },
  server: {
    // Keep port 3000 so `wait-on http://localhost:3000` in `npm run dev`
    // and the Electron main loadURL still match without changes.
    port: 3000,
    strictPort: true,
  },
  build: {
    // Match CRA's output dir so .github/workflows/deploy-pages.yml continues
    // to upload `./build` without modification.
    outDir: 'build',
    sourcemap: true,
    // Keep the chunk size warning generous — alphaTab + ffmpeg are large.
    chunkSizeWarningLimit: 2_000,
  },
});
