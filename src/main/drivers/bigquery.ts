import { BigQuery, type BigQueryOptions } from '@google-cloud/bigquery';
import type { BigQueryProfile } from '@shared/types/profile';
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
 * Google BigQuery driver. BigQuery is a serverless warehouse: there are no
 * long-lived connections or pools, so "connect" just builds a configured
 * client. Auth comes from either the profile's service-account JSON file
 * or Application Default Credentials (ADC — gcloud, metadata server, etc.)
 * when the path is blank.
 */
function toClientOptions(profile: BigQueryProfile): BigQueryOptions {
  const opts: BigQueryOptions = {
    projectId: profile.projectId,
  };
  if (profile.serviceAccountPath) {
    opts.keyFilename = profile.serviceAccountPath;
  }
  return opts;
}

/** Convert an arbitrary BigQuery cell to our JSON-safe `SqlCell` shape. */
function toCell(value: unknown): SqlCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toCell) as SqlCell[];
  if (value instanceof Date) return value.toISOString();
  // BigQuery wraps some types (e.g. BigQueryDate, BigQueryTimestamp) in
  // classes that expose `.value`. Prefer that over `toString()` which
  // sometimes emits `[object Object]`.
  if (typeof value === 'object' && value !== null && 'value' in (value as Record<string, unknown>)) {
    return toCell((value as { value: unknown }).value);
  }
  if (typeof value === 'object') {
    const out: Record<string, SqlCell> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toCell(v);
    }
    return out;
  }
  return String(value);
}

/**
 * Extract column names from BigQuery row objects. BQ's Node client returns
 * plain JS objects without an explicit schema on the response, so we walk
 * the rows to collect a stable column order (first row wins; subsequent
 * rows can't introduce new columns in a single query anyway).
 */
function columnsFromRow(row: Record<string, unknown> | undefined): SqlColumn[] {
  if (!row) return [];
  return Object.keys(row).map((name) => ({ name }));
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

export class BigQueryDriver implements SqlDriver {
  readonly engine = 'bigquery' as const;
  readonly dialect = 'bigquery' as const;

  private constructor(
    public readonly profile: BigQueryProfile,
    private readonly client: BigQuery,
  ) {}

  static async connect(profile: BigQueryProfile): Promise<BigQueryDriver> {
    const client = new BigQuery(toClientOptions(profile));
    return new BigQueryDriver(profile, client);
  }

  async testConnection(): Promise<TestConnectionOutcome> {
    const start = Date.now();
    try {
      // Cheapest round-trip: project-level SELECT 1. Avoids dataset listing
      // which requires `bigquery.datasets.list` ACL that some service
      // accounts lack.
      await this.client.query({
        query: 'SELECT 1 AS probe',
        location: this.profile.location || undefined,
        jobTimeoutMs: Math.min(this.profile.queryTimeoutMs, 15_000),
      });
      return {
        ok: true,
        elapsedMs: Date.now() - start,
        detail: `BigQuery · ${this.profile.projectId}${this.profile.location ? ` (${this.profile.location})` : ''}`,
      };
    } catch (err) {
      return {
        ok: false,
        code: codeFromError(err),
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - start,
      };
    }
  }

  async listContainers(): Promise<TableInfo[]> {
    const dataset = this.profile.defaultDataset;
    if (!dataset) {
      // Without a default dataset, listing "tables" across the project would
      // require enumerating every dataset. Return empty and let the UI point
      // the user at the profile's dataset field.
      return [];
    }
    const [tables] = await this.client.dataset(dataset).getTables();
    return tables.map((t) => ({
      name: t.id ?? '(unknown)',
      schema: dataset,
      tableType: (t.metadata?.type as string | undefined) ?? 'TABLE',
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
    const clamped = clampLimit(safety.normalized, limit, 'bigquery');
    const start = Date.now();
    try {
      const response = (await this.client.query({
        query: clamped,
        location: this.profile.location || undefined,
        jobTimeoutMs: this.profile.queryTimeoutMs,
        maxResults: limit + 1, // fetch one extra to detect truncation
      })) as unknown as [Array<Record<string, unknown>>];
      const rows = response[0] ?? [];
      const trimmed = rows.slice(0, limit);
      const truncated = rows.length > limit;
      return {
        ok: true,
        columns: columnsFromRow(trimmed[0]),
        rows: rowsToMaps(trimmed),
        elapsedMs: Date.now() - start,
        truncated,
        rowCountHint: trimmed.length,
      };
    } catch (err) {
      return {
        ok: false,
        code: codeFromError(err),
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
    const batchSize = Math.max(1, opts.batchSize ?? 1_000);
    const clamped = clampLimit(safety.normalized, opts.hardLimit, 'bigquery');
    const start = Date.now();
    try {
      const [job] = await this.client.createQueryJob({
        query: clamped,
        location: this.profile.location || undefined,
      });

      let emitted = 0;
      let columns: SqlColumn[] | null = null;
      let truncated = false;

      // BigQuery's Node client emits rows one at a time via a readable stream.
      // We accumulate `batchSize` rows before firing `onBatch` so callers get
      // chunked progress (matches the pg / mysql driver semantics).
      await new Promise<void>((resolve, reject) => {
        const stream = job.getQueryResultsStream();
        let pending: SqlCell[][] = [];

        const abort = () => {
          stream.destroy();
          void job.cancel().catch(() => {
            /* best-effort cancel; BQ may have already finished */
          });
        };
        if (opts.signal) {
          if (opts.signal.aborted) {
            abort();
            reject(new Error('Aborted'));
            return;
          }
          opts.signal.addEventListener('abort', abort, { once: true });
        }

        const flush = async () => {
          if (pending.length === 0) return;
          const rowIndexStart = emitted;
          const meta: BatchMeta = columns
            ? { rowIndexStart }
            : { rowIndexStart, columns: columns ?? [] };
          emitted += pending.length;
          const batch = pending;
          pending = [];
          await opts.onBatch(batch, meta);
        };

        stream.on('data', (row: Record<string, unknown>) => {
          if (!columns) columns = columnsFromRow(row);
          if (emitted + pending.length >= opts.hardLimit) {
            truncated = true;
            stream.destroy();
            return;
          }
          pending.push(
            (columns ?? []).map((c) => toCell(row[c.name])),
          );
          if (pending.length >= batchSize) {
            stream.pause();
            void flush()
              .then(() => stream.resume())
              .catch((err) => reject(err));
          }
        });
        stream.on('end', () => {
          void flush().then(resolve).catch(reject);
        });
        stream.on('error', reject);
        stream.on('close', () => {
          // If we destroyed the stream because of hardLimit, resolve cleanly
          // after flushing whatever we had buffered.
          void flush().then(resolve).catch(() => resolve());
        });
      });

      return {
        ok: true,
        columns: columns ?? [],
        totalRows: emitted,
        truncated,
        elapsedMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        code: codeFromError(err),
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - start,
        executedSql: sql,
      };
    }
  }

  async sampleTable(
    table: string,
    schema?: string | null,
    sampleSize = 10,
  ): Promise<SqlTableSample | null> {
    const dataset = schema ?? this.profile.defaultDataset;
    if (!dataset) return null;

    // Resolve column metadata + a row sample. BigQuery exposes the schema
    // via the Table metadata so we don't pay for a DESCRIBE round-trip.
    const tableRef = this.client.dataset(dataset).table(table);
    const [meta] = await tableRef.getMetadata();
    const fields = (meta?.schema?.fields ?? []) as Array<{
      name: string;
      type: string;
      mode?: string;
    }>;
    if (fields.length === 0) return null;

    const fullName = `\`${this.profile.projectId}.${dataset}.${table}\``;
    const response = (await this.client.query({
      query: `SELECT * FROM ${fullName} LIMIT @n`,
      params: { n: sampleSize },
      location: this.profile.location || undefined,
      jobTimeoutMs: this.profile.queryTimeoutMs,
    })) as unknown as [Array<Record<string, unknown>>];
    const rows = response[0] ?? [];

    return {
      table,
      schema: dataset,
      columns: fields.map((f) => ({
        name: f.name,
        dataType: f.type,
        isNullable: (f.mode ?? 'NULLABLE') !== 'REQUIRED',
      })),
      rows: rowsToMaps(rows),
      sampledCount: rows.length,
      sampledAt: Date.now(),
    };
  }

  async dispose(): Promise<void> {
    // BigQuery client has no persistent sockets to release — it issues
    // REST calls under the hood. Nothing to do.
  }
}

/**
 * Probe the datasets available in a given BigQuery project. Called from the
 * ProfilesPage "Load databases" flow so users can pick their default dataset
 * from a list instead of typing it.
 */
export async function probeBigQueryDatasets(cfg: {
  projectId: string;
  serviceAccountPath: string;
  location?: string;
}): Promise<{ ok: true; datasets: string[]; elapsedMs: number } | { ok: false; code: string; message: string; elapsedMs: number }> {
  const start = Date.now();
  try {
    const client = new BigQuery({
      projectId: cfg.projectId,
      keyFilename: cfg.serviceAccountPath || undefined,
    });
    const [datasets] = await client.getDatasets();
    return {
      ok: true,
      datasets: datasets.map((d) => d.id ?? '').filter(Boolean),
      elapsedMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      code: codeFromError(err),
      message: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - start,
    };
  }
}

function codeFromError(err: unknown): string {
  if (typeof err !== 'object' || err === null) return 'BIGQUERY_ERROR';
  const e = err as { code?: string | number; errors?: Array<{ reason?: string }> };
  if (e.errors?.[0]?.reason) return `BIGQUERY_${e.errors[0].reason.toUpperCase()}`;
  if (typeof e.code === 'string') return e.code;
  if (typeof e.code === 'number') return `BIGQUERY_${e.code}`;
  return 'BIGQUERY_ERROR';
}
