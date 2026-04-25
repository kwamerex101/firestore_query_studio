import type { FqsApi, Transport, TransportCapabilities } from './types';
import { IpcChannels } from '@shared/types/ipc';

declare global {
  interface Window {
    fqs: FqsApi;
  }
}

const STALE_PRELOAD_MESSAGE =
  'This renderer is connected to a stale preload bundle. Stop and restart `pnpm dev` — Electron has to re-run the preload script (contextBridge cannot hot-reload).';

function createMissingNamespaceProxy(name: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, method: string | symbol) {
        throw new Error(
          `window.fqs.${name}.${String(method)} is not available. ${STALE_PRELOAD_MESSAGE}`,
        );
      },
    },
  );
}

function resolveApi(): FqsApi {
  const real = window.fqs as Partial<FqsApi> | undefined;
  if (!real) {
    throw new Error(`window.fqs is undefined. ${STALE_PRELOAD_MESSAGE}`);
  }
  const expected: Array<keyof FqsApi> = [
    'profiles',
    'llm',
    'cursor',
    'provider',
    'schema',
    'plan',
    'execute',
    'collections',
    'db',
    'history',
    'insights',
    'visuals',
    'streams',
    'export',
    'dialog',
  ];
  const patched: Record<string, unknown> = { ...real };
  for (const key of expected) {
    if (!patched[key]) {
      patched[key] = createMissingNamespaceProxy(key);
    }
  }
  // Preload is not hot-reloadable: the live `window.fqs.db` object can lag
  // the IPC contract after dev HMR. Expose `ipcInvoke` from preload and
  // reattach missing `db` probe methods here (still requires a process
  // restart once so the new preload is loaded).
  const invokeFromPreload = real.ipcInvoke;
  const db = patched.db as Record<string, unknown> | undefined;
  if (db && typeof invokeFromPreload === 'function') {
    if (typeof db.probeSqlDatabases !== 'function') {
      db.probeSqlDatabases = (input: unknown) =>
        invokeFromPreload(IpcChannels.dbProbeSqlDatabases, input);
    }
    if (typeof db.probeSqlSchemas !== 'function') {
      db.probeSqlSchemas = (input: unknown) =>
        invokeFromPreload(IpcChannels.dbProbeSqlSchemas, input);
    }
  }
  return patched as FqsApi;
}

const capabilities: TransportCapabilities = {
  shell: 'electron',
  postgresProfiles: true,
  mysqlProfiles: true,
  mssqlProfiles: true,
  bigQueryProfiles: true,
  fileProfiles: true,
  cursorCli: true,
  keychainStorage: 'os',
};

export const transport: Transport = {
  api: resolveApi(),
  capabilities,
};
