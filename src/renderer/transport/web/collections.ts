import type {
  DbListContainersResult,
  DbTestConnectionOutcome,
  DbTestConnectionRequest,
  SqlExecuteOutcome,
  SqlPlanBuildOutcome,
  SqlSampleTableResult,
} from '@shared/types/ipc';
import {
  getFirestoreForActive,
  WebProfileNotConfiguredError,
} from './firebase';

/**
 * `collections.list` is tricky on the client: there's no supported
 * Firebase Web SDK call that enumerates top-level collections (the Admin
 * SDK has `listCollections`, but it requires admin credentials we don't
 * have in the browser).
 *
 * Strategy: surface an informative empty list. The renderer's UI falls
 * back to a free-text collection name field when this returns empty, so
 * the user can still type a collection path. A future enhancement could
 * let the user bookmark known collection paths in the profile config.
 */
export async function collectionsList(): Promise<string[]> {
  try {
    await getFirestoreForActive();
  } catch (err) {
    if (err instanceof WebProfileNotConfiguredError) {
      throw new Error(err.message);
    }
    throw err;
  }
  return [];
}

export async function dbTestConnection(
  _req?: DbTestConnectionRequest,
): Promise<DbTestConnectionOutcome> {
  const started = Date.now();
  try {
    // A "successful" web-side connection test is just ensuring Firebase
    // Web SDK can initialize with the saved config. We can't actually
    // reach Firestore without issuing a real query that may be blocked by
    // Security Rules, so keep this check cheap + non-invasive.
    const { config } = await getFirestoreForActive();
    return {
      ok: true,
      elapsedMs: Date.now() - started,
      detail: `Firebase Web SDK initialized for project ${config.projectId}.`,
    };
  } catch (err) {
    const code =
      err instanceof WebProfileNotConfiguredError
        ? err.code
        : err instanceof Error
          ? 'INIT_FAILED'
          : 'UNEXPECTED';
    return {
      ok: false,
      code,
      message: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    };
  }
}

export async function dbListContainers(): Promise<DbListContainersResult> {
  // Firestore has no "listCollections"-equivalent in the Web SDK. Returning
  // an empty list keeps the relational/Firestore container selector
  // consistent across shells — the UI then falls back to a manual
  // collection input.
  return { containers: [] };
}

const WEB_NO_SQL_MESSAGE =
  'SQL engines (Postgres/MySQL/SQL Server) require the desktop app. The browser sandbox cannot open TCP connections to database servers.';

export async function dbExecuteSql(): Promise<SqlExecuteOutcome> {
  return {
    ok: false,
    code: 'UNSUPPORTED_IN_WEB',
    message: WEB_NO_SQL_MESSAGE,
    elapsedMs: 0,
  };
}

export async function dbSampleTable(): Promise<SqlSampleTableResult> {
  return { sample: null };
}

export async function planBuildSql(): Promise<SqlPlanBuildOutcome> {
  return {
    ok: false,
    code: 'UNSUPPORTED_IN_WEB',
    message: WEB_NO_SQL_MESSAGE,
  };
}
