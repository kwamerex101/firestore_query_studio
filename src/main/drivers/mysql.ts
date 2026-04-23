import {
  createPool,
  type Pool,
  type PoolOptions,
  type RowDataPacket,
} from 'mysql2/promise';
import type { MysqlProfile } from '@shared/types/profile';
import type {
  SqlCell,
  SqlColumn as DriverSqlColumn,
  SqlDriver,
  SqlProbeConfig,
  SqlProbeDatabasesOutcome,
  SqlQueryResult,
  SqlTableSample,
  StreamReadOnlyOpts,
  StreamReadOnlyResult,
  TableInfo,
  TestConnectionOutcome,
} from './types';
import { clampLimit, validateReadOnlySql } from '@shared/sqlSafety';

function toPoolOptions(profile: MysqlProfile, password: string | null): PoolOptions {
  const base: PoolOptions = {
    host: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.user,
    password: password ?? undefined,
    // Tiny pool, same reasoning as Postgres — this is a single-user tool.
    connectionLimit: 2,
    waitForConnections: true,
    connectTimeout: Math.min(profile.queryTimeoutMs, 10_000),
    // Disable multiple statements explicitly so a planner bug can't ship
    // `SELECT 1; DROP TABLE users;` in one round-trip. `sqlSafety` catches
    // this too, but belt-and-braces.
    multipleStatements: false,
    dateStrings: true,
    // Keep the wire protocol decoding simple — we coerce to SqlCell on the
    // way out anyway.
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
  switch (profile.sslMode) {
    case 'disable':
      return base;
    case 'require':
      return { ...base, ssl: { rejectUnauthorized: false } };
    case 'verify-full':
      return { ...base, ssl: { rejectUnauthorized: true } };
    default:
      return base;
  }
}

function toSqlCell(value: unknown): SqlCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`;
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
 * Quote a MySQL identifier. MySQL uses backticks and escapes internal
 * backticks by doubling them.
 */
function quoteIdent(ident: string): string {
  return `\`${ident.replace(/`/g, '``')}\``;
}

export class MysqlDriver implements SqlDriver {
  readonly engine = 'mysql' as const;
  readonly dialect = 'mysql' as const;

  private constructor(
    readonly profile: MysqlProfile,
    private readonly pool: Pool,
  ) {}

  static async connect(profile: MysqlProfile, password: string | null): Promise<MysqlDriver> {
    const pool = createPool(toPoolOptions(profile, password));
    return new MysqlDriver(profile, pool);
  }

  async testConnection(): Promise<TestConnectionOutcome> {
    const started = Date.now();
    try {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        'SELECT VERSION() AS version',
      );
      const version = (rows[0] as { version?: string } | undefined)?.version;
      return {
        ok: true,
        elapsedMs: Date.now() - started,
        detail: version ? `MySQL ${version}` : 'connected',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        typeof (err as { code?: unknown }).code === 'string'
          ? ((err as { code: string }).code)
          : 'MYSQL_CONNECT_FAILED';
      return {
        ok: false,
        code,
        message,
        elapsedMs: Date.now() - started,
      };
    }
  }

  async listContainers(): Promise<TableInfo[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT table_schema, table_name, table_type
         FROM information_schema.tables
        WHERE table_schema = ?
          AND table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY table_schema, table_name`,
      [this.profile.database],
    );
    return (rows as Array<{ table_schema: string; table_name: string; table_type: string }>).map(
      (r) => ({
        name: r.table_name,
        schema: r.table_schema,
        tableType: r.table_type,
      }),
    );
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
    const clamped = clampLimit(safety.normalized, effectiveLimit, 'mysql');
    const connection = await this.pool.getConnection();
    try {
      // Nudge the server into read-only transaction semantics. MySQL 5.6+
      // accepts `SET SESSION TRANSACTION READ ONLY`; older MariaDB silently
      // ignores it which is still fine because `sqlSafety` already vetted
      // the statement.
      try {
        await connection.query('SET SESSION TRANSACTION READ ONLY');
      } catch {
        // Not fatal — the safety gate already guarantees a read-only stmt.
      }
      try {
        // Per-statement cap; the unit is milliseconds since MySQL 5.7.
        await connection.query(
          `SET SESSION MAX_EXECUTION_TIME = ?`,
          [this.profile.queryTimeoutMs],
        );
      } catch {
        // MariaDB uses a different variable — skip and rely on the pool
        // connectTimeout + JS-side race.
      }
      const [rows, fields] = await connection.query<RowDataPacket[]>(clamped);
      const columns = (fields ?? []).map((f) => ({
        name: f.name,
        dataType: String(f.type ?? ''),
      }));
      const outRows: Array<Record<string, SqlCell>> = (rows as RowDataPacket[]).map(
        (row) => {
          const out: Record<string, SqlCell> = {};
          for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
            out[k] = toSqlCell(v);
          }
          return out;
        },
      );
      const truncated = outRows.length >= effectiveLimit;
      return {
        ok: true,
        columns,
        rows: outRows,
        elapsedMs: Date.now() - started,
        truncated,
        rowCountHint: outRows.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        typeof (err as { code?: unknown }).code === 'string'
          ? ((err as { code: string }).code)
          : 'MYSQL_QUERY_FAILED';
      return {
        ok: false,
        code,
        message,
        elapsedMs: Date.now() - started,
        executedSql: clamped,
      };
    } finally {
      connection.release();
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
    const clamped = clampLimit(safety.normalized, hardLimit, 'mysql');
    const connection = await this.pool.getConnection();
    let columns: DriverSqlColumn[] = [];
    let columnNames: string[] = [];
    let totalRows = 0;
    let buffer: SqlCell[][] = [];
    let truncated = false;

    try {
      try {
        await connection.query('SET SESSION TRANSACTION READ ONLY');
      } catch {
        /* best-effort; safety gate already ensures read-only */
      }
      try {
        await connection.query('SET SESSION MAX_EXECUTION_TIME = ?', [
          this.profile.queryTimeoutMs,
        ]);
      } catch {
        /* MariaDB — ignore */
      }

      // `mysql2` exposes `connection.connection.query(...).stream()` on the
      // underlying Connection (not the promise wrapper). Use it directly so
      // rows don't buffer in the pool-promise layer.
      const raw = (connection as unknown as {
        connection: {
          query: (sql: string) => {
            stream: (opts: { highWaterMark: number }) => NodeJS.ReadableStream & {
              on: (ev: string, cb: (...args: unknown[]) => void) => unknown;
              destroy: (err?: Error) => void;
              pause: () => void;
              resume: () => void;
            };
            on: (ev: 'fields', cb: (fields: Array<{ name: string; type?: number }>) => void) => void;
          };
        };
      }).connection;

      const query = raw.query(clamped);
      query.on('fields', (fields) => {
        columns = (fields ?? []).map((f) => ({
          name: f.name,
          dataType: String(f.type ?? ''),
        }));
        columnNames = columns.map((c) => c.name);
      });

      const stream = query.stream({ highWaterMark: batchSize });

      const flushBuffer = async (): Promise<void> => {
        if (buffer.length === 0) return;
        const batch = buffer;
        buffer = [];
        await opts.onBatch(batch, {
          rowIndexStart: totalRows - batch.length,
          columns: totalRows === batch.length ? columns : undefined,
        });
      };

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
          if (settled) return;
          settled = true;
          stream.destroy(new Error('ABORTED'));
        };
        if (opts.signal) {
          if (opts.signal.aborted) {
            onAbort();
          } else {
            opts.signal.addEventListener('abort', onAbort, { once: true });
          }
        }

        stream.on('error', (err: unknown) => {
          if (settled) return;
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        });
        stream.on('end', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        stream.on('data', (row: unknown) => {
          if (settled) return;
          if (columnNames.length === 0) {
            columnNames = Object.keys(row as Record<string, unknown>);
            columns = columnNames.map((name) => ({ name }));
          }
          const tuple: SqlCell[] = columnNames.map((name) =>
            toSqlCell((row as Record<string, unknown>)[name]),
          );
          buffer.push(tuple);
          totalRows += 1;
          if (totalRows >= hardLimit) {
            truncated = true;
            settled = true;
            void flushBuffer()
              .then(() => {
                stream.destroy();
                resolve();
              })
              .catch(reject);
            return;
          }
          if (buffer.length >= batchSize) {
            stream.pause();
            void flushBuffer()
              .then(() => {
                if (!settled) stream.resume();
              })
              .catch((err) => {
                if (settled) return;
                settled = true;
                stream.destroy(err);
                reject(err);
              });
          }
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
      if ((err as Error).message === 'ABORTED') {
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
          : 'MYSQL_STREAM_FAILED';
      return {
        ok: false,
        code,
        message,
        elapsedMs: Date.now() - started,
        executedSql: clamped,
      };
    } finally {
      connection.release();
    }
  }

  async sampleTable(
    table: string,
    schema?: string | null,
    sampleSize: number = 10,
  ): Promise<SqlTableSample | null> {
    const targetSchema = schema ?? this.profile.database;
    const [colRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position`,
      [targetSchema, table],
    );
    const cols = colRows as Array<{
      column_name?: string;
      COLUMN_NAME?: string;
      data_type?: string;
      DATA_TYPE?: string;
      is_nullable?: string;
      IS_NULLABLE?: string;
    }>;
    if (cols.length === 0) return null;
    const qualified = `${quoteIdent(targetSchema)}.${quoteIdent(table)}`;
    const [sampleRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM ${qualified} LIMIT ?`,
      [Math.max(1, Math.min(sampleSize, 200))],
    );
    const rows: Array<Record<string, SqlCell>> = (sampleRows as RowDataPacket[]).map(
      (row) => {
        const out: Record<string, SqlCell> = {};
        for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
          out[k] = toSqlCell(v);
        }
        return out;
      },
    );
    return {
      table,
      schema: targetSchema,
      columns: cols.map((c) => ({
        name: String(c.column_name ?? c.COLUMN_NAME ?? ''),
        dataType: String(c.data_type ?? c.DATA_TYPE ?? ''),
        isNullable: String(c.is_nullable ?? c.IS_NULLABLE ?? 'NO').toUpperCase() === 'YES',
      })),
      rows,
      sampledCount: rows.length,
      sampledAt: Date.now(),
    };
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Short-lived pool options for MySQL probes. No default database (so
 * we can list schemata without picking one first), tiny pool, 5s
 * connect timeout. Independent from profile timeouts on purpose.
 */
function toProbePoolOptions(cfg: SqlProbeConfig): PoolOptions {
  const base: PoolOptions = {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password ?? undefined,
    connectionLimit: 1,
    waitForConnections: true,
    connectTimeout: 5_000,
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
  switch (cfg.sslMode) {
    case 'disable':
      return base;
    case 'require':
      return { ...base, ssl: { rejectUnauthorized: false } };
    case 'verify-full':
      return { ...base, ssl: { rejectUnauthorized: true } };
    default:
      return base;
  }
}

/**
 * List user-visible schemas (= databases in MySQL terms). System
 * catalogs (`information_schema`, `mysql`, `performance_schema`, `sys`)
 * are filtered out.
 */
export async function probeMysqlDatabases(
  cfg: SqlProbeConfig,
): Promise<SqlProbeDatabasesOutcome> {
  const started = Date.now();
  const pool = createPool(toProbePoolOptions(cfg));
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT SCHEMA_NAME
         FROM information_schema.SCHEMATA
        WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')
        ORDER BY SCHEMA_NAME`,
    );
    const databases = (rows as Array<{ SCHEMA_NAME?: string; schema_name?: string }>).map(
      (r) => String(r.SCHEMA_NAME ?? r.schema_name ?? ''),
    ).filter((n) => n.length > 0);
    return {
      ok: true,
      databases,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : 'MYSQL_PROBE_FAILED';
    return {
      ok: false,
      code,
      message,
      elapsedMs: Date.now() - started,
    };
  } finally {
    try {
      await pool.end();
    } catch {
      /* swallow */
    }
  }
}
