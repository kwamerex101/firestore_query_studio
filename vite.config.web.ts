import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Standalone web / PWA build of the renderer.
 *
 * Why a second config instead of reusing `electron.vite.config.ts`?
 *   - Electron's renderer loads the preload bridge (`window.fqs`) whereas
 *     the web build talks to Firebase Web SDK / IndexedDB / fetch directly.
 *     The `@transport` alias below swaps the transport layer at build time.
 *   - The desktop build uses `electron-vite`'s multi-target mode and has
 *     no need for a service worker or manifest.
 *   - A clean split keeps `pnpm build` (Electron) fast and avoids pulling
 *     vite-plugin-pwa into the main-process bundler.
 *
 * Layout:
 *   - `web/index.html`  → web-specific HTML with a relaxed CSP.
 *   - `web/main.tsx`    → re-exports `src/renderer/main.tsx` so both shells
 *                         share a single React root.
 *   - `src/renderer/public/` → static assets (SVG icons) served at `/`.
 *
 * Scripts:
 *   - `pnpm dev:web`   → local dev server (port 5174 to avoid clashing with
 *                        electron-vite's 5173 renderer dev server).
 *   - `pnpm build:web` → emits a static SPA to `dist/web/` that can be
 *                        uploaded to Firebase Hosting, Vercel, Netlify, etc.
 */
export default defineConfig({
  root: resolve(__dirname, 'web'),
  base: './',
  publicDir: resolve(__dirname, 'src/renderer/public'),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The service worker caches the app shell so the PWA is installable
      // and works offline for navigation. All data (Firestore, LLM calls)
      // requires network, as expected — the SW simply gets out of the way
      // by using a NetworkFirst strategy for those.
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern:
              /^https:\/\/(firestore|identitytoolkit|securetoken)\.googleapis\.com\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'firebase-api',
              networkTimeoutSeconds: 10,
              expiration: { maxAgeSeconds: 60 * 5, maxEntries: 50 },
            },
          },
          {
            urlPattern: /^https:\/\/[^/]+\/chat\/completions$/,
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'Firestore Query Studio',
        short_name: 'Firestore QS',
        description:
          'Query Firestore with natural language. Web/PWA build — desktop app available separately.',
        theme_color: '#0b0b0b',
        background_color: '#0b0b0b',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        // Set PWA_DEV=1 to exercise the service worker in `pnpm dev:web`.
        // Off by default so iteration speed stays fast and stale SWs don't
        // confuse the renderer during HMR.
        enabled: process.env.PWA_DEV === '1',
        type: 'module',
      },
      includeAssets: ['favicon.svg', 'icon.svg'],
    }),
  ],
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    // Firebase + Firestore ship big bundles. Raise the warning bar so CI
    // doesn't cry about legitimate vendor chunks, but keep it finite so a
    // runaway import (e.g. accidentally pulling in firebase-admin) screams.
    chunkSizeWarningLimit: 900,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      // Point the shared `@transport` alias at the web implementation. The
      // Electron build points it at `transport/index.ts` (→ electron.ts).
      '@transport': resolve(__dirname, 'src/renderer/transport/web'),
    },
  },
  server: {
    port: 5174,
    host: '127.0.0.1',
    strictPort: true,
  },
  preview: {
    port: 5174,
    host: '127.0.0.1',
    strictPort: true,
  },
});
