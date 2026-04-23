import {
  isFirestoreProfile,
  isMssqlProfile,
  isMysqlProfile,
  isPostgresProfile,
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
import {
  PostgresDriver,
  probePostgresDatabases,
  probePostgresSchemas,
} from './postgres';
import { MysqlDriver, probeMysqlDatabases } from './mysql';
import {
  MssqlDriver,
  probeMssqlDatabases,
  probeMssqlSchemas,
} from './mssql';
import { getProfileSecret } from '../profiles/secrets';

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
  if (isPostgresProfile(profile)) {
    const password = await getProfileSecret(profile.id);
    return PostgresDriver.connect(profile, password);
  }
  if (isMysqlProfile(profile)) {
    const password = await getProfileSecret(profile.id);
    return MysqlDriver.connect(profile, password);
  }
  if (isMssqlProfile(profile)) {
    const password = await getProfileSecret(profile.id);
    return MssqlDriver.connect(profile, password);
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
      return probePostgresDatabases(cfg);
    case 'mysql':
      return probeMysqlDatabases(cfg);
    case 'mssql':
      return probeMssqlDatabases(cfg);
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
      return probePostgresSchemas(cfg, database);
    case 'mssql':
      return probeMssqlSchemas(cfg, database);
    case 'mysql':
      return {
        ok: false,
        code: 'UNSUPPORTED_ENGINE',
        message: 'MySQL has no distinct schema layer; use the database dropdown.',
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
export { PostgresDriver } from './postgres';
export { MysqlDriver } from './mysql';
export { MssqlDriver } from './mssql';
