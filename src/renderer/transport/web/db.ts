import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * IndexedDB schema for the web/PWA transport. This database replaces the
 * filesystem JSON + OS-keychain used by the Electron shell. Everything here
 * is device-local; nothing leaves the browser.
 *
 * Versioning: bump `DB_VERSION` and add a migration arm in `openDB`'s
 * `upgrade` callback whenever a new store is introduced.
 */

const DB_NAME = 'firestore-query-studio';
const DB_VERSION = 1;

interface FqsDB extends DBSchema {
  profiles: {
    key: string;
    value: {
      id: string;
      profile: unknown;
      firebaseConfig?: unknown;
      updatedAt: number;
    };
  };
  settings: {
    key: string;
    value: unknown;
  };
  history: {
    key: string;
    value: {
      id: string;
      createdAt: number;
      payload: unknown;
      /**
       * Dedupe key derived from `{question, collection, planHash}` so the
       * renderer's "cached plan" lookup can hit an index instead of a full
       * scan. Set to null when the entry came from a run (not from a plan
       * lookup cache).
       */
      cacheKey: string | null;
    };
    indexes: { 'by-createdAt': 'createdAt'; 'by-cacheKey': 'cacheKey' };
  };
  schemaOverrides: {
    key: string;
    value: {
      /** `${collection}|${collectionGroup ? 'cg' : 'c'}|${profileId}`. */
      id: string;
      payload: unknown;
      updatedAt: number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<FqsDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<FqsDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FqsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        if (!db.objectStoreNames.contains('history')) {
          const history = db.createObjectStore('history', { keyPath: 'id' });
          history.createIndex('by-createdAt', 'createdAt');
          history.createIndex('by-cacheKey', 'cacheKey');
        }
        if (!db.objectStoreNames.contains('schemaOverrides')) {
          db.createObjectStore('schemaOverrides', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/** Well-known keys in the `settings` store so they're not littered across the code. */
export const SettingsKeys = {
  activeProfileId: 'activeProfileId',
  llmSettings: 'llmSettings',
  llmProvider: 'llmProvider',
  cursorSettings: 'cursorSettings',
  deviceKey: 'deviceKey',
} as const;
