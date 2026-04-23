/**
 * Web/PWA bootstrap. The actual mount logic lives in
 * [src/renderer/main.tsx](../src/renderer/main.tsx); we just re-export it so
 * both the Electron renderer and the web build share a single source of
 * truth for the root React tree.
 *
 * The transport layer is swapped at build time via the `@transport` Vite
 * alias — see [vite.config.web.ts](../vite.config.web.ts).
 *
 * If you're deploying a PWA: the service worker registration is handled by
 * `virtual:pwa-register`, which vite-plugin-pwa injects automatically when
 * `registerType: 'autoUpdate'` is set. That means there is nothing extra to
 * wire up here.
 */
import '../src/renderer/main';
