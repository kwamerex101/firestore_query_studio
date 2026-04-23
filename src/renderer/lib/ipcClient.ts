import { transport } from '@transport';
import type {
  AuthUserProfile,
  FirebaseWebConfig,
  FqsApi,
  IpcApi,
  IpcChannel,
  Transport,
  TransportCapabilities,
  WebExtensions,
} from '@transport';

/**
 * The renderer's single entry point for talking to "the backend". The actual
 * implementation comes from [src/renderer/transport](../transport) and is
 * selected at build time via the `@transport` Vite alias:
 *
 *   - Electron (default) → `src/renderer/transport/electron.ts`
 *   - Web / PWA          → `src/renderer/transport/web`
 *
 * All UI code should import `ipc` from this module; it must never touch
 * `window.fqs` or `ipcRenderer` directly.
 */
export const ipc: FqsApi = transport.api;

/**
 * Runtime capability flags describing what this shell can do (e.g. whether
 * Postgres profiles or the Cursor CLI planner are available). The UI uses
 * these to hide desktop-only controls on the web build.
 */
export const capabilities: TransportCapabilities = transport.capabilities;

/**
 * Web-only extensions (Firebase Web config + Firebase Auth). `undefined`
 * on desktop; UI code must feature-detect before using.
 */
export const webExtensions: WebExtensions | undefined = transport.web;

export type {
  AuthUserProfile,
  FirebaseWebConfig,
  FqsApi,
  IpcApi,
  IpcChannel,
  Transport,
  TransportCapabilities,
  WebExtensions,
};
