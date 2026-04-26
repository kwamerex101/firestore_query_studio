import {
  isBigQueryProfile,
  isFileProfile,
  isFirestoreProfile,
  isMssqlProfile,
  isMysqlProfile,
  isPostgresProfile,
  isRtdbProfile,
  type Profile,
  type SqlDialect,
} from '@shared/types/profile';
import type {
  DatabaseDriver,
  SqlProbeConfig,
  SqlProbeDatabasesOutcome,
  SqlProbeSchemasOutcome,
} from './types';
import { FirestoreDriver } from './firestore';
import { RtdbDriver } from './rtdb';
import { getProfileSecret } from '../profiles/secrets';

/**
 * Dynamic loaders for the relational drivers. Each relational driver module
 * pulls in a native Node addon (`pg` → libpq bindings, `mysql2` → decimal
 * parser, `mssql` → tedious). Loading them at startup for a Firestore-only
 * user is wasted cost. We defer each import until the first time that
 * engine is actually used, then cache the module.
 */
let postgresMod: typeof import('./postgres') | null = null;
let mysqlMod: typeof import('./mysql') | null = null;
let mssqlMod: typeof import('./mssql') | null = null;
let bigqueryMod: typeof import('./bigquery') | null = null;
let fileSqliteMod: typeof import('./fileSqlite') | null = null;

async function loadPostgres() {
  if (!postgresMod) postgresMod = await import('./postgres');
  return postgresMod;
}
async function loadMysql() {
  if (!mysqlMod) mysqlMod = await import('./mysql');
  return mysqlMod;
}
async function loadMssql() {
  if (!mssqlMod) mssqlMod = await import('./mssql');
  return mssqlMod;
}
async function loadBigQuery() {
  if (!bigqueryMod) bigqueryMod = await import('./bigquery');
  return bigqueryMod;
}
async function loadFileSqlite() {
  if (!fileSqliteMod) fileSqliteMod = await import('./fileSqlite');
  return fileSqliteMod;
}

/**
 * Factory that returns the right driver for a profile. For relational
 * engines it fetches the keychain-stored password lazily — plaintext is
 * only accepted on IPC calls other than create/update (where it never
 * leaves the main process).
 */
export async function createDriver(profile: Profile): Promise<DatabaseDriver> {
  if (isFirestoreProfile(profile)) {
    return FirestoreDriver.connect(profile);
  }
  if (isRtdbProfile(profile)) {
    return RtdbDriver.connect(profile);
  }
  if (isPostgresProfile(profile)) {
    const [{ PostgresDriver }, password] = await Promise.all([
      loadPostgres(),
      getProfileSecret(profile.id),
    ]);
    return PostgresDriver.connect(profile, password);
  }
  if (isMysqlProfile(profile)) {
    const [{ MysqlDriver }, password] = await Promise.all([
      loadMysql(),
      getProfileSecret(profile.id),
    ]);
    return MysqlDriver.connect(profile, password);
  }
  if (isMssqlProfile(profile)) {
    const [{ MssqlDriver }, password] = await Promise.all([
      loadMssql(),
      getProfileSecret(profile.id),
    ]);
    return MssqlDriver.connect(profile, password);
  }
  if (isBigQueryProfile(profile)) {
    const { BigQueryDriver } = await loadBigQuery();
    return BigQueryDriver.connect(profile);
  }
  if (isFileProfile(profile)) {
    const { SqliteFileDriver } = await loadFileSqlite();
    return SqliteFileDriver.connect(profile);
  }
  // Exhaustiveness guard — if Engine gains a variant and nobody updates this
  // file, TypeScript will flag `profile` as `never` right here.
  const _exhaustive: never = profile;
  throw new Error(`Unsupported engine: ${(_exhaustive as { engine?: string }).engine ?? 'unknown'}`);
}

/**
 * Dispatch a "list databases" probe to the right driver. The probe
 * opens a short-lived pool outside the normal driver lifecycle and
 * closes it before returning; it does not affect the active profile's
 * long-lived driver instance.
 */
export async function probeSqlDatabases(
  engine: SqlDialect,
  cfg: SqlProbeConfig,
): Promise<SqlProbeDatabasesOutcome> {
  switch (engine) {
    case 'postgres':
      return (await loadPostgres()).probePostgresDatabases(cfg);
    case 'mysql':
      return (await loadMysql()).probeMysqlDatabases(cfg);
    case 'mssql':
      return (await loadMssql()).probeMssqlDatabases(cfg);
    case 'bigquery':
      // BigQuery's "databases" are datasets and use a completely different
      // auth shape (service-account JSON). Callers should route through
      // `probeBigQueryDatasets` directly with a dedicated config.
      return {
        ok: false,
        code: 'UNSUPPORTED_ENGINE',
        message: 'BigQuery dataset listing uses a separate probe.',
        elapsedMs: 0,
      };
    case 'sqlite':
      // File-backed profiles ship their own SQLite; no probe needed.
      return {
        ok: false,
        code: 'UNSUPPORTED_ENGINE',
        message: 'File-backed profiles do not support the SQL probe flow.',
        elapsedMs: 0,
      };
    default: {
      const _exhaustive: never = engine;
      return {
        ok: false,
        code: 'UNSUPPORTED_ENGINE',
        message: `Unsupported engine for probe: ${String(_exhaustive)}`,
        elapsedMs: 0,
      };
    }
  }
}

/**
 * Dispatch a "list schemas in database" probe. MySQL has no distinct
 * schema layer (schema == database) so it rejects with
 * `UNSUPPORTED_ENGINE` — callers should simply hide the schema
 * dropdown for MySQL profiles.
 */
export async function probeSqlSchemas(
  engine: SqlDialect,
  cfg: SqlProbeConfig,
  database: string,
): Promise<SqlProbeSchemasOutcome> {
  switch (engine) {
    case 'postgres':
      return (await loadPostgres()).probePostgresSchemas(cfg, database);
    case 'mssql':
      return (await loadMssql()).probeMssqlSchemas(cfg, database);
    case 'mysql':
      return {
        ok: false,
        code: 'UNSUPPORTED_ENGINE',
        message: 'MySQL has no distinct schema layer; use the database dropdown.',
        elapsedMs: 0,
      };
    case 'bigquery':
      return {
        ok: false,
        code: 'UNSUPPORTED_ENGINE',
        message: 'BigQuery datasets map onto the database dropdown, not schemas.',
        elapsedMs: 0,
      };
    case 'sqlite':
      return {
        ok: false,
        code: 'UNSUPPORTED_ENGINE',
        message: 'File-backed profiles have no schema layer.',
        elapsedMs: 0,
      };
    default: {
      const _exhaustive: never = engine;
      return {
        ok: false,
        code: 'UNSUPPORTED_ENGINE',
        message: `Unsupported engine for probe: ${String(_exhaustive)}`,
        elapsedMs: 0,
      };
    }
  }
}

export type { DatabaseDriver, SqlDriver } from './types';
export { isSqlDriver } from './types';
export { FirestoreDriver } from './firestore';
export { RtdbDriver } from './rtdb';
