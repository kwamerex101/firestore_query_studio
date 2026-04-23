import { Pool, type PoolConfig } from 'pg';
import QueryStream from 'pg-query-stream';
import type { PostgresProfile } from '@shared/types/profile';
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

function toPoolConfig(profile: PostgresProfile, password: string | null): PoolConfig {
  const base: PoolConfig = {
    host: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.user,
    password: password ?? undefined,
    // Keep the pool small for a single desktop user; connection churn isn't
    // our bottleneck and a tiny pool makes idle cleanup trivial.
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: Math.min(profile.queryTimeoutMs, 10_000),
    application_name: 'firestore-query-studio',
    statement_timeout: profile.queryTimeoutMs,
  };
  switch (profile.sslMode) {
    case 'disable':
      return { ...base, ssl: false };
    case 'require':
      // Most managed Postgres (Supabase, Neon, RDS default) requires TLS but
      // hands out certs signed by chains Node doesn't ship. `require` means
      // "encrypted, don't verify" — the same semantics as libpq.
      return { ...base, ssl: { rejectUnauthorized: false } };
    case 'verify-full':
      return { ...base, ssl: { rejectUnauthorized: true } };
    default:
      return base;
  }
}

/**
 * Coerce a Postgres cell value into a JSON-safe `SqlCell`. `pg`'s type
 * parsers already decode most scalars (numbers, booleans, JSON) but leave
 * Date objects, BigInts, and Buffers in their native form — those need
 * stringifying before we ship them across IPC.
 */
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

export class PostgresDriver implements SqlDriver {
  readonly engine = 'postgres' as const;
  readonly dialect = 'postgres' as const;

  private constructor(
    readonly profile: PostgresProfile,
    private readonly pool: Pool,
  ) {}

  static async connect(profile: PostgresProfile, password: string | null): Promise<PostgresDriver> {
    const pool = new Pool(toPoolConfig(profile, password));
    // Do NOT pre-warm here: tests often run without a real DB, and we want
    // `connect()` to be cheap. Failures surface from testConnection()/
    // listContainers() which callers use explicitly.
    return new PostgresDriver(profile, pool);
  }

  async testConnection(): Promise<TestConnectionOutcome> {
    const started = Date.now();
    try {
      const res = await this.pool.query<{ version: string }>('select version() as version');
      return {
        ok: true,
        elapsedMs: Date.now() - started,
        detail: res.rows[0]?.version ?? 'connected',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // `pg` error codes come in as .code on PG errors; surface them verbatim
      // so the UI can show "ECONNREFUSED" / "28P01" etc.
      const code =
        typeof (err as { code?: unknown }).code === 'string'
          ? ((err as { code: string }).code)
          : 'POSTGRES_CONNECT_FAILED';
      return {
        ok: false,
        code,
        message,
        elapsedMs: Date.now() - started,
      };
    }
  }

  async listContainers(): Promise<TableInfo[]> {
    const res = await this.pool.query<{
      table_schema: string;
      table_name: string;
      table_type: string;
    }>(
      `select table_schema, table_name, table_type
         from information_schema.tables
        where table_schema = $1
          and table_type in ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW', 'FOREIGN TABLE')
        order by table_schema, table_name`,
      [this.profile.schema],
    );
    return res.rows.map((r) => ({
      name: r.table_name,
      schema: r.table_schema,
      tableType: r.table_type,
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
    const clamped = clampLimit(safety.normalized, effectiveLimit, 'postgres');
    const client = await this.pool.connect();
    try {
      // Belt-and-braces: Postgres supports session-level read-only enforcement.
      await client.query('BEGIN READ ONLY');
      const res = await client.query(clamped);
      await client.query('COMMIT');
      const columns = res.fields.map((f) => ({
        name: f.name,
        dataType: String(f.dataTypeID),
      }));
      const rows: Array<Record<string, SqlCell>> = res.rows.map((row) => {
        const out: Record<string, SqlCell> = {};
        for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
          out[k] = toSqlCell(v);
        }
        return out;
      });
      const truncated = rows.length >= effectiveLimit;
      return {
        ok: true,
        columns,
        rows,
        elapsedMs: Date.now() - started,
        truncated,
        rowCountHint: res.rowCount ?? rows.length,
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Swallow — the client may already be in an errored state.
      }
      const message = err instanceof Error ? err.message : String(err);
      const code =
        typeof (err as { code?: unknown }).code === 'string'
          ? ((err as { code: string }).code)
          : 'POSTGRES_QUERY_FAILED';
      return {
        ok: false,
        code,
        message,
        elapsedMs: Date.now() - started,
        executedSql: clamped,
      };
    } finally {
      client.release();
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
    const clamped = clampLimit(safety.normalized, hardLimit, 'postgres');
    const client = await this.pool.connect();
    let columns: DriverSqlColumn[] = [];
    let totalRows = 0;
    let buffer: SqlCell[][] = [];
    let truncated = false;
    let columnNames: string[] = [];

    const stream = new QueryStream(clamped, [], {
      batchSize,
      highWaterMark: batchSize,
    });

    try {
      await client.query('BEGIN READ ONLY');
      const query = client.query(stream);

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

        stream.on('error', (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
        stream.on('end', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        stream.on('data', (row) => {
          if (settled) return;
          if (columns.length === 0) {
            // `pg-query-stream` exposes field meta via the underlying cursor
            // only after first row. Fall back to row key order to keep the
            // tuple encoding stable across subsequent batches.
            const cursor = (stream as unknown as { cursor?: { _result?: { fields?: Array<{ name: string; dataTypeID: number }> } } }).cursor;
            const fields = cursor?._result?.fields ?? [];
            if (fields.length > 0) {
              columns = fields.map((f) => ({
                name: f.name,
                dataType: String(f.dataTypeID),
              }));
            } else {
              columns = Object.keys(row as Record<string, unknown>).map((name) => ({ name }));
            }
            columnNames = columns.map((c) => c.name);
          }
          const tuple: SqlCell[] = columnNames.map((name) =>
            toSqlCell((row as Record<string, unknown>)[name]),
          );
          buffer.push(tuple);
          totalRows += 1;
          if (totalRows >= hardLimit) {
            truncated = true;
            settled = true;
            // Flush remaining rows on next tick so we don't block inside the
            // emitter.
            void flushBuffer()
              .then(() => {
                stream.destroy();
                resolve();
              })
              .catch(reject);
            return;
          }
          if (buffer.length >= batchSize) {
            // Pause, flush, then resume. `pg-query-stream` uses Node streams
            // under the hood so pause/resume is respected.
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
        // Node streams may resolve 'end' before our last pause/flush; make
        // sure we surface the remainder before resolving.
        stream.on('close', () => {
          void query; // silence unused-variable warning in strict builds
        });
      });

      await flushBuffer();
      try {
        await client.query('COMMIT');
      } catch {
        /* ignored */
      }

      return {
        ok: true,
        columns,
        totalRows,
        truncated,
        elapsedMs: Date.now() - started,
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignored */
      }
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
          : 'POSTGRES_STREAM_FAILED';
      return {
        ok: false,
        code,
        message,
        elapsedMs: Date.now() - started,
        executedSql: clamped,
      };
    } finally {
      client.release();
    }
  }

  async sampleTable(
    table: string,
    schema?: string | null,
    sampleSize: number = 10,
  ): Promise<SqlTableSample | null> {
    const targetSchema = schema ?? this.profile.schema;
    const colRes = await this.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: 'YES' | 'NO';
    }>(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema = $1 and table_name = $2
        order by ordinal_position`,
      [targetSchema, table],
    );
    if (colRes.rows.length === 0) return null;
    // `information_schema` ident pieces are safe to interpolate here because
    // we just round-tripped them through it — they came from the DB itself.
    const qualified = `"${targetSchema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
    const sample = await this.pool.query(
      `select * from ${qualified} limit $1`,
      [Math.max(1, Math.min(sampleSize, 200))],
    );
    const rows: Array<Record<string, SqlCell>> = sample.rows.map((row) => {
      const out: Record<string, SqlCell> = {};
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        out[k] = toSqlCell(v);
      }
      return out;
    });
    return {
      table,
      schema: targetSchema,
      columns: colRes.rows.map((c) => ({
        name: c.column_name,
        dataType: c.data_type,
        isNullable: c.is_nullable === 'YES',
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
 * Short-lived pool config for probe queries. Mirrors `toPoolConfig` but
 * forces a tiny 1-connection pool with a fixed 5s connect timeout so
 * the UI doesn't wait on a profile-level `queryTimeoutMs` (often 60s)
 * just to populate a dropdown.
 */
function toProbePoolConfig(cfg: SqlProbeConfig, database: string): PoolConfig {
  const base: PoolConfig = {
    host: cfg.host,
    port: cfg.port,
    database,
    user: cfg.user,
    password: cfg.password ?? undefined,
    max: 1,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'firestore-query-studio (probe)',
    statement_timeout: 5_000,
  };
  switch (cfg.sslMode) {
    case 'disable':
      return { ...base, ssl: false };
    case 'require':
      return { ...base, ssl: { rejectUnauthorized: false } };
    case 'verify-full':
      return { ...base, ssl: { rejectUnauthorized: true } };
    default:
      return base;
  }
}

function pgErrorCodeOrFallback(err: unknown, fallback: string): string {
  return typeof (err as { code?: unknown }).code === 'string'
    ? (err as { code: string }).code
    : fallback;
}

/**
 * List databases reachable on this cluster with the given credentials.
 * Attempts `postgres` first (the standard admin DB), falls back to
 * `template1` when the target server doesn't ship a `postgres` db
 * (e.g. DigitalOcean Managed Postgres names theirs `defaultdb`). On
 * success the caller gets the names the user can `CONNECT` to.
 */
export async function probePostgresDatabases(
  cfg: SqlProbeConfig,
): Promise<SqlProbeDatabasesOutcome> {
  const started = Date.now();
  const bootstrap = ['postgres', 'template1'];
  let lastErr: unknown = null;
  for (const dbName of bootstrap) {
    const pool = new Pool(toProbePoolConfig(cfg, dbName));
    try {
      const res = await pool.query<{ datname: string }>(
        `SELECT datname
           FROM pg_database
          WHERE datistemplate = false
            AND has_database_privilege(current_user, datname, 'CONNECT')
          ORDER BY datname`,
      );
      return {
        ok: true,
        databases: res.rows.map((r) => r.datname),
        elapsedMs: Date.now() - started,
      };
    } catch (err) {
      lastErr = err;
      // `3D000` = "database does not exist" — try the next bootstrap DB.
      // Anything else (auth, network, TLS) is fatal; bail immediately.
      const code = (err as { code?: unknown }).code;
      if (code !== '3D000') break;
    } finally {
      try {
        await pool.end();
      } catch {
        /* swallow: pool may already be tearing down */
      }
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'Unknown error');
  return {
    ok: false,
    code: pgErrorCodeOrFallback(lastErr, 'POSTGRES_PROBE_FAILED'),
    message,
    elapsedMs: Date.now() - started,
  };
}

/**
 * List schemas inside a specific database. Excludes the catalog /
 * pseudo-schemas so the dropdown stays focused on user-visible spaces.
 */
export async function probePostgresSchemas(
  cfg: SqlProbeConfig,
  database: string,
): Promise<SqlProbeSchemasOutcome> {
  const started = Date.now();
  const pool = new Pool(toProbePoolConfig(cfg, database));
  try {
    const res = await pool.query<{ schema_name: string }>(
      `SELECT schema_name
         FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
          AND schema_name NOT LIKE 'pg_%'
        ORDER BY schema_name`,
    );
    return {
      ok: true,
      schemas: res.rows.map((r) => r.schema_name),
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: pgErrorCodeOrFallback(err, 'POSTGRES_PROBE_FAILED'),
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
