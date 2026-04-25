import type { Database as SqliteDb, Statement } from 'better-sqlite3';
import type { FileProfile } from '@shared/types/profile';
import type {
  BatchMeta,
  SqlCell,
  SqlColumn,
  SqlDriver,
  SqlQueryResult,
  SqlTableSample,
  StreamReadOnlyOpts,
  StreamReadOnlyResult,
  TableInfo,
  TestConnectionOutcome,
} from './types';
import { clampLimit, validateReadOnlySql } from '@shared/sqlSafety';

/**
 * SqlDriver implementation for CSV/XLSX-backed profiles.
 *
 * The file has already been parsed into a per-profile SQLite database by
 * `fileImport.importFileToSqlite`. This driver just opens that database
 * read-only and implements the shared SqlDriver surface. Pools, passwords,
 * and network concerns don't apply — a single `better-sqlite3` Database
 * handle is plenty for a single-user desktop app.
 */

function toCell(value: unknown): SqlCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  try {
    return JSON.stringify(value as Record<string, unknown>);
  } catch {
    return String(value);
  }
}

function rowsToMaps(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, SqlCell>> {
  return rows.map((row) => {
    const out: Record<string, SqlCell> = {};
    for (const [k, v] of Object.entries(row)) out[k] = toCell(v);
    return out;
  });
}

function columnsFromStatement(stmt: Statement): SqlColumn[] {
  try {
    const cols = stmt.columns();
    return cols.map((c) => ({
      name: c.name,
      dataType: c.type ?? undefined,
    }));
  } catch {
    return [];
  }
}

export class SqliteFileDriver implements SqlDriver {
  readonly engine = 'file' as const;
  readonly dialect = 'sqlite' as const;

  private constructor(
    public readonly profile: FileProfile,
    private readonly db: SqliteDb,
  ) {}

  static async connect(profile: FileProfile): Promise<SqliteFileDriver> {
    const { default: BetterSqlite } = await import('better-sqlite3');
    const db = new BetterSqlite(profile.sqlitePath, { readonly: true, fileMustExist: true });
    // Query-timeout enforcement; better-sqlite3 doesn't honour a direct
    // per-query timeout, but the pragma here caps the busy wait for
    // competing writers on the same file (there shouldn't be any — we
    // open read-only — but this keeps runaway transactions bounded).
    db.pragma(`busy_timeout = ${profile.queryTimeoutMs}`);
    return new SqliteFileDriver(profile, db);
  }

  async testConnection(): Promise<TestConnectionOutcome> {
    const start = Date.now();
    try {
      const row = this.db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
      return {
        ok: true,
        elapsedMs: Date.now() - start,
        detail: `SQLite ${row.v} · ${this.profile.tables.length} table${this.profile.tables.length === 1 ? '' : 's'}`,
      };
    } catch (err) {
      return {
        ok: false,
        code: 'SQLITE_ERROR',
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - start,
      };
    }
  }

  async listContainers(): Promise<TableInfo[]> {
    const rows = this.db
      .prepare(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string; type: string }>;
    return rows.map((r) => ({
      name: r.name,
      schema: null,
      tableType: r.type.toUpperCase(),
    }));
  }

  async runReadOnlyQuery(
    sql: string,
    opts?: { limit?: number },
  ): Promise<SqlQueryResult> {
    const safety = validateReadOnlySql(sql);
    if (!safety.ok) {
      return {
        ok: false,
        code: 'SQL_NOT_READ_ONLY',
        message: safety.message,
        elapsedMs: 0,
      };
    }
    const limit = opts?.limit ?? this.profile.defaultLimit;
    // SQLite accepts `LIMIT N` just like Postgres/MySQL; the shared helper
    // appends it when the statement doesn't already have one.
    const clamped = clampLimit(safety.normalized, limit, 'postgres');
    const start = Date.now();
    try {
      const stmt = this.db.prepare(clamped);
      stmt.raw(false);
      const rows = stmt.all() as Array<Record<string, unknown>>;
      const truncated = rows.length > limit;
      const trimmed = truncated ? rows.slice(0, limit) : rows;
      return {
        ok: true,
        columns: columnsFromStatement(stmt),
        rows: rowsToMaps(trimmed),
        elapsedMs: Date.now() - start,
        truncated,
        rowCountHint: trimmed.length,
      };
    } catch (err) {
      return {
        ok: false,
        code: 'SQLITE_ERROR',
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - start,
        executedSql: clamped,
      };
    }
  }

  async streamReadOnlyQuery(
    sql: string,
    opts: StreamReadOnlyOpts,
  ): Promise<StreamReadOnlyResult> {
    const safety = validateReadOnlySql(sql);
    if (!safety.ok) {
      return {
        ok: false,
        code: 'SQL_NOT_READ_ONLY',
        message: safety.message,
        elapsedMs: 0,
      };
    }
    const clamped = clampLimit(safety.normalized, opts.hardLimit, 'postgres');
    const batchSize = Math.max(1, opts.batchSize ?? 1_000);
    const start = Date.now();
    try {
      const stmt = this.db.prepare(clamped);
      // `.raw(true)` returns rows as tuple arrays — matches the SqlCell[][]
      // shape onBatch expects without an extra conversion.
      stmt.raw(true);
      const columns = columnsFromStatement(stmt);
      let emitted = 0;
      let truncated = false;
      let pending: SqlCell[][] = [];
      const iterator = stmt.iterate() as IterableIterator<unknown[]>;
      for (const tuple of iterator) {
        if (opts.signal?.aborted) {
          truncated = true;
          break;
        }
        if (emitted + pending.length >= opts.hardLimit) {
          truncated = true;
          break;
        }
        pending.push(tuple.map(toCell));
        if (pending.length >= batchSize) {
          const batch = pending;
          pending = [];
          const meta: BatchMeta =
            emitted === 0 ? { rowIndexStart: emitted, columns } : { rowIndexStart: emitted };
          emitted += batch.length;
          await opts.onBatch(batch, meta);
        }
      }
      if (pending.length > 0) {
        const meta: BatchMeta =
          emitted === 0 ? { rowIndexStart: emitted, columns } : { rowIndexStart: emitted };
        emitted += pending.length;
        await opts.onBatch(pending, meta);
      }
      return {
        ok: true,
        columns,
        totalRows: emitted,
        truncated,
        elapsedMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        code: 'SQLITE_ERROR',
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - start,
        executedSql: clamped,
      };
    }
  }

  async sampleTable(
    table: string,
    _schema?: string | null,
    sampleSize = 10,
  ): Promise<SqlTableSample | null> {
    const tableInfo = this.db
      .prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)
      .all() as Array<{ name: string; type: string; notnull: number }>;
    if (tableInfo.length === 0) return null;
    const sampleStmt = this.db.prepare(
      `SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT ?`,
    );
    const rows = sampleStmt.all(sampleSize) as Array<Record<string, unknown>>;
    return {
      table,
      schema: null,
      columns: tableInfo.map((c) => ({
        name: c.name,
        dataType: c.type || 'TEXT',
        isNullable: c.notnull === 0,
      })),
      rows: rowsToMaps(rows),
      sampledCount: rows.length,
      sampledAt: Date.now(),
    };
  }

  async dispose(): Promise<void> {
    try { this.db.close(); } catch { /* ignore */ }
  }
}
