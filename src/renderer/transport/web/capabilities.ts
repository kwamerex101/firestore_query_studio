import type { TransportCapabilities } from '../types';

export const capabilities: TransportCapabilities = {
  shell: 'web',
  // Browser builds cannot speak the Postgres/MySQL/MSSQL wire protocols
  // and have no access to `node:net`. Hide relational profiles in the UI.
  postgresProfiles: false,
  mysqlProfiles: false,
  mssqlProfiles: false,
  // BigQuery auth requires reading a service-account JSON from disk; the
  // browser can't resolve file paths reliably and bundle size wants to stay
  // lean. Desktop-only.
  bigQueryProfiles: false,
  // The Cursor CLI is a local binary spawned via `node:child_process`.
  // Browsers obviously cannot do this; hide the Cursor provider picker.
  cursorCli: false,
  // Web Crypto + IndexedDB is weaker than the OS keychain the Electron
  // build uses — make that explicit so the UI can surface a security note.
  keychainStorage: 'indexeddb',
};
