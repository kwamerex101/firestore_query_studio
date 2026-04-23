import type { Engine, Profile, SqlDialect, SqlProfile, SslMode } from '@shared/types/profile';

export interface TableInfo {
  name: string;
  schema: string | null;
  tableType: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey: boolean;
}

export interface TestConnectionOk {
  ok: true;
  elapsedMs: number;
  /** Engine-specific free-form detail for the UI (e.g. "PostgreSQL 16.1"). */
  detail?: string;
}

export interface TestConnectionErr {
  ok: false;
  code: string;
  message: string;
  elapsedMs: number;
}

export type TestConnectionOutcome = TestConnectionOk | TestConnectionErr;

/**
 * Minimum surface every engine must implement. Individual drivers (Firestore,
 * Postgres, …) extend this with engine-specific methods — e.g. Firestore
 * exposes the raw Admin SDK handle via `firestore`, Postgres exposes a
 * read-only query runner. The shared parts are what the IPC surface speaks.
 */
export interface DatabaseDriver {
  readonly engine: Engine;
  readonly profile: Profile;

  /** Lightweight round-trip to verify credentials / reachability. */
  testConnection(): Promise<TestConnectionOutcome>;

  /**
   * List the "top-level containers" of the DB. Firestore: root collections.
   * Postgres: tables in the profile's default schema.
   */
  listContainers(): Promise<TableInfo[]>;

  dispose(): Promise<void>;
}

/**
 * One row from a SQL query result. JSON-safe primitives only — dates are
 * stringified, buffers are hex-encoded. The executor is responsible for
 * coercing engine-specific types into this shape before shipping across
 * IPC.
 */
export type SqlCell =
  | string
  | number
  | boolean
  | null
  | SqlCell[]
  | { [key: string]: SqlCell };

export interface SqlColumn {
  /** Column name as returned by the driver. */
  name: string;
  /** Human-readable type hint (e.g. "int4", "VARCHAR(255)"). Optional. */
  dataType?: string;
}

export interface SqlQueryResultOk {
  ok: true;
  columns: SqlColumn[];
  rows: Array<Record<string, SqlCell>>;
  elapsedMs: number;
  /**
   * True when the server returned more rows than `profile.defaultLimit` and
   * the driver trimmed the tail before returning. The planner prompt asks
   * the model to emit `LIMIT`/`TOP` itself, but we still clamp defensively.
   */
  truncated: boolean;
  /** Engine-reported row count hint — some drivers surface this separately. */
  rowCountHint?: number;
}

export interface SqlQueryResultErr {
  ok: false;
  code: string;
  message: string;
  elapsedMs: number;
  /** Safe-to-show query string the driver actually executed, for debugging. */
  executedSql?: string;
}

export type SqlQueryResult = SqlQueryResultOk | SqlQueryResultErr;

export interface SqlTableSampleColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
}

export interface SqlTableSample {
  /** Fully-qualified table identifier as given to `sampleTable`. */
  table: string;
  /** Logical schema (pg: `public`, mysql: the database, mssql: `dbo`). */
  schema: string | null;
  columns: SqlTableSampleColumn[];
  /** Up to `sampleSize` sample rows in JSON-safe form, mirroring a SELECT *. */
  rows: Array<Record<string, SqlCell>>;
  sampledCount: number;
  sampledAt: number;
}

/**
 * Super-interface implemented by every relational driver (Postgres, MySQL,
 * MSSQL). Firestore does NOT implement this — callers that need SQL must
 * narrow via `isSqlDriver()`.
 *
 * The shared NL→SQL planner, SQL executor, and `QueryPage` all route
 * through this interface, so adding a future dialect (Oracle, etc.) is
 * purely a "new driver class" job.
 */
/**
 * Options passed to `streamReadOnlyQuery`. `onBatch` is called with a
 * tuple batch (rows as `SqlCell[][]`) and may return a promise — the
 * driver awaits it before fetching the next chunk, giving callers
 * natural backpressure. `signal` lets the caller cancel mid-stream.
 */
export interface StreamReadOnlyOpts {
  /** Overall row ceiling. Streaming stops after this many rows are emitted. */
  hardLimit: number;
  /** Target batch size (rows per `onBatch` call). Drivers may emit fewer near the tail. */
  batchSize?: number;
  /** Called once per batch; returned promise is awaited before continuing. */
  onBatch: (
    rows: SqlCell[][],
    meta: BatchMeta,
  ) => void | Promise<void>;
  /** Aborts the run as soon as the driver can stop the cursor. */
  signal?: AbortSignal;
}

export interface BatchMeta {
  /** Zero-based index of the first row in this batch across the whole run. */
  rowIndexStart: number;
  /** Emitted on the first batch only; column order matches each row's tuple. */
  columns?: SqlColumn[];
}

export interface StreamReadOnlyOk {
  ok: true;
  columns: SqlColumn[];
  /** Total rows passed to `onBatch` (may be less than source rows if truncated). */
  totalRows: number;
  /** True if the driver stopped short of the source because `hardLimit` was hit. */
  truncated: boolean;
  elapsedMs: number;
}
export interface StreamReadOnlyErr {
  ok: false;
  code: string;
  message: string;
  elapsedMs: number;
  executedSql?: string;
}
export type StreamReadOnlyResult = StreamReadOnlyOk | StreamReadOnlyErr;

export interface SqlDriver extends DatabaseDriver {
  readonly dialect: SqlDialect;
  /** Narrowed profile; always a SQL engine (Postgres/MySQL/MSSQL). */
  readonly profile: SqlProfile;

  /**
   * Run a single read-only statement. The caller is expected to have
   * already run the string through `sqlSafety.validate()` — the driver
   * treats it as trusted input at this point but will still wrap it in
   * a transaction / `SET TRANSACTION READ ONLY` where cheap.
   */
  runReadOnlyQuery(
    sql: string,
    opts?: { limit?: number },
  ): Promise<SqlQueryResult>;

  /**
   * Stream a read-only query through `onBatch` in fixed-size tuple
   * batches. Never materializes the full result in main-process memory,
   * so 500k+ row scans stay bounded by the batch size rather than the
   * overall row count. Callers (IPC, export-to-disk) are responsible
   * for applying their own `uiLimit` / write backpressure on top of
   * the driver's `hardLimit`.
   */
  streamReadOnlyQuery(
    sql: string,
    opts: StreamReadOnlyOpts,
  ): Promise<StreamReadOnlyResult>;

  /**
   * Sample a table's column definitions + N example rows. Used by the
   * planner to build a schema snapshot for the prompt. Returns `null`
   * when the table doesn't exist — callers decide whether to treat that
   * as an error.
   */
  sampleTable(
    table: string,
    schema?: string | null,
    sampleSize?: number,
  ): Promise<SqlTableSample | null>;
}

export function isSqlDriver(driver: DatabaseDriver): driver is SqlDriver {
  return (
    driver.engine === 'postgres' ||
    driver.engine === 'mysql' ||
    driver.engine === 'mssql'
  );
}

/**
 * Resolved connection inputs for a SQL probe. Built by the IPC router
 * from either a saved profile (password from keychain) or a live form
 * draft (plaintext password flowing on IPC once). Drivers use this to
 * open a short-lived pool outside the normal lifecycle.
 */
export interface SqlProbeConfig {
  engine: SqlDialect;
  host: string;
  port: number;
  user: string;
  password: string | null;
  sslMode: SslMode;
  /** MSSQL-only: `encrypt` toggle forwarded to tedious. */
  encrypt?: boolean;
  /** MSSQL-only: trust self-signed server certificate. */
  trustServerCertificate?: boolean;
  /** MSSQL-only: named instance. When set, port is ignored (SQL Browser). */
  instanceName?: string;
}

export interface SqlProbeDatabasesOk {
  ok: true;
  databases: string[];
  elapsedMs: number;
}
export interface SqlProbeDatabasesErr {
  ok: false;
  code: string;
  message: string;
  elapsedMs: number;
}
export type SqlProbeDatabasesOutcome = SqlProbeDatabasesOk | SqlProbeDatabasesErr;

export interface SqlProbeSchemasOk {
  ok: true;
  schemas: string[];
  elapsedMs: number;
}
export interface SqlProbeSchemasErr {
  ok: false;
  code: string;
  message: string;
  elapsedMs: number;
}
export type SqlProbeSchemasOutcome = SqlProbeSchemasOk | SqlProbeSchemasErr;
