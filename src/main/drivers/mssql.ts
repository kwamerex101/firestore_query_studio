import * as mssql from 'mssql';
import type { MssqlProfile } from '@shared/types/profile';
import type {
  SqlCell,
  SqlColumn as DriverSqlColumn,
  SqlDriver,
  SqlProbeConfig,
  SqlProbeDatabasesOutcome,
  SqlProbeSchemasOutcome,
  SqlQueryResult,
  SqlTableSample,
  StreamReadOnlyOpts,
  StreamReadOnlyResult,
  TableInfo,
  TestConnectionOutcome,
} from './types';
import { clampLimit, validateReadOnlySql } from '@shared/sqlSafety';

function toMssqlConfig(
  profile: MssqlProfile,
  password: string | null,
): mssql.config {
  const cfg: mssql.config = {
    server: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.user,
    password: password ?? undefined,
    connectionTimeout: Math.min(profile.queryTimeoutMs, 10_000),
    requestTimeout: profile.queryTimeoutMs,
    pool: {
      min: 0,
      max: 2,
      idleTimeoutMillis: 30_000,
    },
    options: {
      encrypt: profile.encrypt,
      trustServerCertificate: profile.trustServerCertificate,
      appName: 'firestore-query-studio',
      // Tedious parses numeric/decimal columns into JS `number`, which
      // silently loses precision above 2^53. Letting it hand us strings
      // (enableArithAbort aside) keeps parity with MySQL/PG big-number
      // handling.
      enableArithAbort: true,
    },
  };
  if (profile.instanceName && profile.instanceName.length > 0) {
    // Named instance. Tedious ignores `port` in this mode and uses the SQL
    // Browser service to resolve the dynamic port.
    (cfg.options as { instanceName?: string }).instanceName = profile.instanceName;
    delete (cfg as { port?: number }).port;
  }
  return cfg;
}

function toSqlCell(value: unknown): SqlCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex').toUpperCase()}`;
  if (Array.isArray(value)) return value.map(toSqlCell);
  if (typeof value === 'object') {
    const out: Record<string, SqlCell> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toSqlCell(v);
    }
    return out;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

/**
 * Quote a SQL Server identifier with square brackets and escape embedded
 * closing brackets.
 */
function quoteIdent(ident: string): string {
  return `[${ident.replace(/]/g, ']]')}]`;
}

export class MssqlDriver implements SqlDriver {
  readonly engine = 'mssql' as const;
  readonly dialect = 'mssql' as const;

  private constructor(
    readonly profile: MssqlProfile,
    private readonly pool: mssql.ConnectionPool,
  ) {}

  static async connect(profile: MssqlProfile, password: string | null): Promise<MssqlDriver> {
    const pool = new mssql.ConnectionPool(toMssqlConfig(profile, password));
    // `pool.connect()` returns the same pool and rejects on auth failures,
    // so we await it here — unlike pg/mysql2 which lazy-connect on first
    // query, tedious needs the handshake up front to configure requests.
    await pool.connect();
    return new MssqlDriver(profile, pool);
  }

  async testConnection(): Promise<TestConnectionOutcome> {
    const started = Date.now();
    try {
      const request = this.pool.request();
      const result = await request.query<{ version: string }>('SELECT @@VERSION AS version');
      const version = result.recordset[0]?.version;
      return {
        ok: true,
        elapsedMs: Date.now() - started,
        detail: version ? version.split('\n')[0]?.trim() : 'connected',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        typeof (err as { code?: unknown }).code === 'string'
          ? ((err as { code: string }).code)
          : 'MSSQL_CONNECT_FAILED';
      return {
        ok: false,
        code,
        message,
        elapsedMs: Date.now() - started,
      };
    }
  }

  async listContainers(): Promise<TableInfo[]> {
    const request = this.pool.request();
    request.input('catalog', mssql.NVarChar, this.profile.database);
    const result = await request.query<{
      TABLE_SCHEMA: string;
      TABLE_NAME: string;
      TABLE_TYPE: string;
    }>(
      `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
         FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_CATALOG = @catalog
          AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
        ORDER BY TABLE_SCHEMA, TABLE_NAME`,
    );
    return result.recordset.map((r) => ({
      name: r.TABLE_NAME,
      schema: r.TABLE_SCHEMA,
      tableType: r.TABLE_TYPE,
    }));
  }

  async runReadOnlyQuery(
    sql: string,
    opts?: { limit?: number },
  ): Promise<SqlQueryResult> {
    const started = Date.now();
    const safety = validateReadOnlySql(sql);
    if (!safety.ok) {
      return {
        ok: false,
        code: safety.code,
        message: safety.message,
        elapsedMs: Date.now() - started,
      };
    }
    const effectiveLimit = Math.max(
      1,
      Math.min(opts?.limit ?? this.profile.defaultLimit, this.profile.defaultLimit),
    );
    const clamped = clampLimit(safety.normalized, effectiveLimit, 'mssql');
    try {
      const request = this.pool.request();
      const result = await request.query(clamped);
      const recordset = result.recordset ?? [];
      // Use the recordset columns metadata when available for type hints.
      const firstRecordset = Array.isArray(result.recordsets)
        ? (result.recordsets as mssql.IRecordSet<unknown>[])[0]
        : undefined;
      const columnsMeta = firstRecordset?.columns ?? {};
      const colNames = recordset.length > 0 ? Object.keys(recordset[0] as object) : Object.keys(columnsMeta);
      const columns = colNames.map((name) => {
        const meta = (columnsMeta as Record<string, { type?: { name?: string } | { declaration?: string } }>)[name];
        const typeName =
          (meta?.type as { declaration?: string } | undefined)?.declaration ??
          (meta?.type as { name?: string } | undefined)?.name;
        return { name, dataType: typeName ?? '' };
      });
      const rows: Array<Record<string, SqlCell>> = (recordset as Array<Record<string, unknown>>).map(
        (row) => {
          const out: Record<string, SqlCell> = {};
          for (const [k, v] of Object.entries(row)) {
            out[k] = toSqlCell(v);
          }
          return out;
        },
      );
      const truncated = rows.length >= effectiveLimit;
      return {
        ok: true,
        columns,
        rows,
        elapsedMs: Date.now() - started,
        truncated,
        rowCountHint: Array.isArray(result.rowsAffected)
          ? result.rowsAffected[result.rowsAffected.length - 1]
          : rows.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        typeof (err as { code?: unknown }).code === 'string'
          ? ((err as { code: string }).code)
          : 'MSSQL_QUERY_FAILED';
      return {
        ok: false,
        code,
        message,
        elapsedMs: Date.now() - started,
        executedSql: clamped,
      };
    }
  }

  async streamReadOnlyQuery(
    sql: string,
    opts: StreamReadOnlyOpts,
  ): Promise<StreamReadOnlyResult> {
    const started = Date.now();
    const safety = validateReadOnlySql(sql);
    if (!safety.ok) {
      return {
        ok: false,
        code: safety.code,
        message: safety.message,
        elapsedMs: Date.now() - started,
      };
    }
    const hardLimit = Math.max(1, Math.min(opts.hardLimit, this.profile.defaultLimit));
    const batchSize = Math.max(100, Math.min(opts.batchSize ?? 5_000, 50_000));
    const clamped = clampLimit(safety.normalized, hardLimit, 'mssql');

    let columns: DriverSqlColumn[] = [];
    let columnNames: string[] = [];
    let totalRows = 0;
    let buffer: SqlCell[][] = [];
    let truncated = false;

    const request = this.pool.request();
    request.stream = true;

    const flushBuffer = async (): Promise<void> => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      await opts.onBatch(batch, {
        rowIndexStart: totalRows - batch.length,
        columns: totalRows === batch.length ? columns : undefined,
      });
    };

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
          if (settled) return;
          settled = true;
          request.cancel();
        };
        if (opts.signal) {
          if (opts.signal.aborted) {
            onAbort();
          } else {
            opts.signal.addEventListener('abort', onAbort, { once: true });
          }
        }

        request.on('recordset', (cols: Record<string, { type?: { declaration?: string; name?: string } }>) => {
          columnNames = Object.keys(cols);
          columns = columnNames.map((name) => {
            const meta = cols[name];
            const typeName =
              (meta?.type as { declaration?: string } | undefined)?.declaration ??
              (meta?.type as { name?: string } | undefined)?.name;
            return { name, dataType: typeName ?? '' };
          });
        });

        request.on('row', (row: Record<string, unknown>) => {
          if (settled) return;
          if (columnNames.length === 0) {
            columnNames = Object.keys(row);
            columns = columnNames.map((name) => ({ name }));
          }
          const tuple: SqlCell[] = columnNames.map((name) => toSqlCell(row[name]));
          buffer.push(tuple);
          totalRows += 1;
          if (totalRows >= hardLimit) {
            truncated = true;
            settled = true;
            void flushBuffer()
              .then(() => {
                request.cancel();
                resolve();
              })
              .catch(reject);
            return;
          }
          if (buffer.length >= batchSize) {
            request.pause();
            void flushBuffer()
              .then(() => {
                if (!settled) request.resume();
              })
              .catch((err) => {
                if (settled) return;
                settled = true;
                request.cancel();
                reject(err);
              });
          }
        });

        request.on('error', (err: Error) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
        request.on('done', () => {
          if (settled) return;
          settled = true;
          resolve();
        });

        request.query(clamped).catch((err: unknown) => {
          if (settled) return;
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      });

      await flushBuffer();
      return {
        ok: true,
        columns,
        totalRows,
        truncated,
        elapsedMs: Date.now() - started,
      };
    } catch (err) {
      const cancelled =
        (err as { code?: string } | undefined)?.code === 'ECANCEL' ||
        (err instanceof Error && /cancel/i.test(err.message));
      if (cancelled) {
        return {
          ok: false,
          code: 'ABORTED',
          message: 'Query stream was aborted.',
          elapsedMs: Date.now() - started,
          executedSql: clamped,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      const code =
        typeof (err as { code?: unknown }).code === 'string'
          ? ((err as { code: string }).code)
          : 'MSSQL_STREAM_FAILED';
      return {
        ok: false,
        code,
        message,
        elapsedMs: Date.now() - started,
        executedSql: clamped,
      };
    }
  }

  async sampleTable(
    table: string,
    schema?: string | null,
    sampleSize: number = 10,
  ): Promise<SqlTableSample | null> {
    const targetSchema = schema ?? 'dbo';
    const request = this.pool.request();
    request.input('catalog', mssql.NVarChar, this.profile.database);
    request.input('schema', mssql.NVarChar, targetSchema);
    request.input('table', mssql.NVarChar, table);
    const colResult = await request.query<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      IS_NULLABLE: 'YES' | 'NO';
    }>(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_CATALOG = @catalog AND TABLE_SCHEMA = @schema AND TABLE_NAME = @table
        ORDER BY ORDINAL_POSITION`,
    );
    if (colResult.recordset.length === 0) return null;
    const qualified = `${quoteIdent(targetSchema)}.${quoteIdent(table)}`;
    const safeSize = Math.max(1, Math.min(sampleSize, 200));
    const sampleRequest = this.pool.request();
    // Inlining the integer here is safe because `safeSize` is clamped and
    // numeric; TOP does not accept a parameter binding in all scenarios.
    const sampleResult = await sampleRequest.query(
      `SELECT TOP (${safeSize}) * FROM ${qualified}`,
    );
    const rows: Array<Record<string, SqlCell>> = (
      sampleResult.recordset as Array<Record<string, unknown>>
    ).map((row) => {
      const out: Record<string, SqlCell> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = toSqlCell(v);
      }
      return out;
    });
    return {
      table,
      schema: targetSchema,
      columns: colResult.recordset.map((c) => ({
        name: c.COLUMN_NAME,
        dataType: c.DATA_TYPE,
        isNullable: c.IS_NULLABLE === 'YES',
      })),
      rows,
      sampledCount: rows.length,
      sampledAt: Date.now(),
    };
  }

  async dispose(): Promise<void> {
    await this.pool.close();
  }
}

/**
 * Short-lived MSSQL config for probes. Defaults to `master` since that
 * DB is always present on a reachable instance; if the caller wants a
 * different bootstrap DB they can override.
 */
function toProbeMssqlConfig(cfg: SqlProbeConfig, database: string): mssql.config {
  const probe: mssql.config = {
    server: cfg.host,
    port: cfg.port,
    database,
    user: cfg.user,
    password: cfg.password ?? undefined,
    connectionTimeout: 5_000,
    requestTimeout: 5_000,
    pool: {
      min: 0,
      max: 1,
      idleTimeoutMillis: 1_000,
    },
    options: {
      encrypt: cfg.encrypt ?? true,
      trustServerCertificate: cfg.trustServerCertificate ?? false,
      appName: 'firestore-query-studio (probe)',
      enableArithAbort: true,
    },
  };
  if (cfg.instanceName && cfg.instanceName.length > 0) {
    (probe.options as { instanceName?: string }).instanceName = cfg.instanceName;
    delete (probe as { port?: number }).port;
  }
  return probe;
}

async function withMssqlProbePool<T>(
  cfg: SqlProbeConfig,
  database: string,
  fn: (pool: mssql.ConnectionPool) => Promise<T>,
): Promise<T> {
  const pool = new mssql.ConnectionPool(toProbeMssqlConfig(cfg, database));
  try {
    await pool.connect();
    return await fn(pool);
  } finally {
    try {
      await pool.close();
    } catch {
      /* swallow */
    }
  }
}

/**
 * List user databases on the instance that the current principal can
 * access. System DBs (master/tempdb/model/msdb, id <= 4) and DBs the
 * user has no access to are filtered out server-side.
 */
export async function probeMssqlDatabases(
  cfg: SqlProbeConfig,
): Promise<SqlProbeDatabasesOutcome> {
  const started = Date.now();
  try {
    const databases = await withMssqlProbePool(cfg, 'master', async (pool) => {
      const result = await pool.request().query<{ name: string }>(
        `SELECT name FROM sys.databases
          WHERE database_id > 4 AND HAS_DBACCESS(name) = 1
          ORDER BY name`,
      );
      return result.recordset.map((r) => r.name);
    });
    return { ok: true, databases, elapsedMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : 'MSSQL_PROBE_FAILED';
    return { ok: false, code, message, elapsedMs: Date.now() - started };
  }
}

/**
 * List schemas inside a specific MSSQL database. Excludes built-in
 * `sys`/`INFORMATION_SCHEMA` and the fixed database-role schemas so
 * only user-space shows up in the dropdown.
 */
export async function probeMssqlSchemas(
  cfg: SqlProbeConfig,
  database: string,
): Promise<SqlProbeSchemasOutcome> {
  const started = Date.now();
  try {
    const schemas = await withMssqlProbePool(cfg, database, async (pool) => {
      const result = await pool.request().query<{ name: string }>(
        `SELECT name FROM sys.schemas
          WHERE name NOT IN (
            'sys','INFORMATION_SCHEMA','guest',
            'db_owner','db_accessadmin','db_securityadmin','db_ddladmin',
            'db_backupoperator','db_datareader','db_datawriter',
            'db_denydatareader','db_denydatawriter'
          )
          ORDER BY name`,
      );
      return result.recordset.map((r) => r.name);
    });
    return { ok: true, schemas, elapsedMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : 'MSSQL_PROBE_FAILED';
    return { ok: false, code, message, elapsedMs: Date.now() - started };
  }
}
