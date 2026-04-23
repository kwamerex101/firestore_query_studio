/**
 * Barrel re-export selected by the bundler via the `@transport` alias.
 *
 *   - `electron.vite.config.ts` (desktop / default) → `./electron`
 *   - `vite.config.web.ts` (web/PWA, added in the `web-build` task) → `./web`
 *
 * Keep this file a pure re-export so both build targets compile to the same
 * module shape.
 */
export { transport } from './electron';
export type {
  AuthUserProfile,
  FirebaseWebConfig,
  FqsApi,
  Transport,
  TransportCapabilities,
  WebExtensions,
  IpcApi,
  IpcChannel,
} from './types';
