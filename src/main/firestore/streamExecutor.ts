import type { Firestore } from 'firebase-admin/firestore';
import type { QueryPlan, QueryOnlyPlan, ScanPlan } from '@shared/types/plan';
import { isMulti, isQueryOnly, isScan } from '@shared/types/plan';
import type { CollectionSchema } from '@shared/types/schema';
import type { ResultRow } from '@shared/types/results';
import {
  buildQueryFromPlan as buildQuery,
  matchesPostFilter,
  serializeDoc,
} from './executorShared';

export interface StreamExecutorDeps {
  firestore: Firestore;
  profileScanCap: number;
  getSchema?: (
    collection: string,
    collectionGroup: boolean,
  ) => Promise<CollectionSchema | null>;
  now?: () => number;
}

export interface StreamBatchMeta {
  rowIndexStart: number;
  /** Hit `hardLimit` or cap and truncated the source. */
  truncated: boolean;
}

export interface StreamRunOpts {
  /** Overall row ceiling after any post-filtering. */
  hardLimit: number;
  /** Rows per `onBatch` call. Drivers may emit fewer at the tail. */
  batchSize: number;
  /** Aborts streaming as soon as the cursor yields control. */
  signal?: AbortSignal;
  onBatch: (rows: ResultRow[], meta: StreamBatchMeta) => void | Promise<void>;
}

export interface StreamRunResult {
  ok: true;
  totalRows: number;
  scanned: number;
  matched: number;
  truncated: boolean;
  warnings: string[];
  elapsedMs: number;
}
export interface StreamRunError {
  ok: false;
  code: string;
  message: string;
  elapsedMs: number;
  warnings: string[];
}
export type StreamRunOutcome = StreamRunResult | StreamRunError;

async function resolveSchema(
  deps: StreamExecutorDeps,
  plan: QueryOnlyPlan | ScanPlan,
): Promise<CollectionSchema | null> {
  if (!deps.getSchema) return null;
  try {
    return await deps.getSchema(plan.collection, plan.collectionGroup);
  } catch {
    return null;
  }
}

/**
 * Stream a Firestore plan through `onBatch`. Uses `q.stream()` for
 * query-only / scan plans and degrades to a sequential run for multi
 * plans (rare, and bounded by `hardLimit` anyway).
 *
 * Returned promise resolves after the final batch has been awaited by
 * the caller, giving natural backpressure: the main process can pause
 * reading from the Firestore cursor while the renderer or exporter
 * drains.
 */
export async function runPlanStream(
  deps: StreamExecutorDeps,
  plan: QueryPlan,
  opts: StreamRunOpts,
): Promise<StreamRunOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const warnings: string[] = [];
  const hardLimit = Math.max(1, Math.min(opts.hardLimit, 10_000_000));
  const batchSize = Math.max(100, Math.min(opts.batchSize, 50_000));

  try {
    if (isQueryOnly(plan)) {
      return await streamQueryOnly(deps, plan, {
        ...opts,
        hardLimit,
        batchSize,
      }, warnings, started, now);
    }
    if (isScan(plan)) {
      return await streamScan(deps, plan, {
        ...opts,
        hardLimit,
        batchSize,
      }, warnings, started, now);
    }
    if (isMulti(plan)) {
      // Multi-step plans are rare and already bounded by the sub-plan
      // limits. Stream each step sequentially into the same `onBatch`.
      let totalRows = 0;
      let scanned = 0;
      let matched = 0;
      let truncated = false;
      for (const step of plan.steps) {
        const remaining = hardLimit - totalRows;
        if (remaining <= 0) {
          truncated = true;
          break;
        }
        const stepOpts: StreamRunOpts = {
          ...opts,
          hardLimit: remaining,
          batchSize,
          onBatch: async (rows, meta) => {
            await opts.onBatch(rows, {
              rowIndexStart: totalRows + meta.rowIndexStart,
              truncated: meta.truncated,
            });
          },
        };
        const outcome = isQueryOnly(step)
          ? await streamQueryOnly(deps, step, stepOpts, warnings, started, now)
          : await streamScan(deps, step, stepOpts, warnings, started, now);
        if (!outcome.ok) return outcome;
        totalRows += outcome.totalRows;
        scanned += outcome.scanned;
        matched += outcome.matched;
        truncated = truncated || outcome.truncated;
      }
      return {
        ok: true,
        totalRows,
        scanned,
        matched,
        truncated,
        warnings,
        elapsedMs: now() - started,
      };
    }
    return {
      ok: false,
      code: 'UNSUPPORTED_PLAN',
      message: `Unsupported plan mode: ${(plan as { mode: string }).mode}`,
      elapsedMs: now() - started,
      warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if ((err as Error).message === 'ABORTED') {
      return {
        ok: false,
        code: 'ABORTED',
        message: 'Firestore stream was aborted.',
        elapsedMs: now() - started,
        warnings,
      };
    }
    return {
      ok: false,
      code: 'EXECUTION_ERROR',
      message,
      elapsedMs: now() - started,
      warnings,
    };
  }
}

async function streamQueryOnly(
  deps: StreamExecutorDeps,
  plan: QueryOnlyPlan,
  opts: StreamRunOpts,
  warnings: string[],
  started: number,
  now: () => number,
): Promise<StreamRunOutcome> {
  const schema = await resolveSchema(deps, plan);
  const localWarnings: string[] = [];
  const effectiveLimit = Math.min(plan.limit, opts.hardLimit);
  const q = buildQuery(deps.firestore, plan, schema, localWarnings).limit(effectiveLimit);
  warnings.push(...localWarnings);

  let buffer: ResultRow[] = [];
  let totalRows = 0;
  const stream = q.stream();

  const flush = async (final: boolean): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    await opts.onBatch(batch, {
      rowIndexStart: totalRows - batch.length,
      truncated: final && totalRows >= effectiveLimit,
    });
  };

  await consumeStream(stream, opts.signal, async (snap) => {
    const row = serializeDoc(snap);
    buffer.push(row);
    totalRows += 1;
    if (totalRows >= effectiveLimit) {
      await flush(true);
      return 'done';
    }
    if (buffer.length >= opts.batchSize) {
      await flush(false);
    }
    return 'continue';
  });
  await flush(true);

  return {
    ok: true,
    totalRows,
    scanned: totalRows,
    matched: totalRows,
    truncated: totalRows >= effectiveLimit,
    warnings,
    elapsedMs: now() - started,
  };
}

async function streamScan(
  deps: StreamExecutorDeps,
  plan: ScanPlan,
  opts: StreamRunOpts,
  warnings: string[],
  started: number,
  now: () => number,
): Promise<StreamRunOutcome> {
  const schema = await resolveSchema(deps, plan);
  const localWarnings: string[] = [];
  const effectiveCap = Math.min(plan.scanCap, deps.profileScanCap, opts.hardLimit);
  if (effectiveCap < plan.scanCap) {
    localWarnings.push(
      `Scan cap reduced from plan.scanCap=${plan.scanCap} to ${effectiveCap}.`,
    );
  }
  const q = buildQuery(deps.firestore, plan, schema, localWarnings).limit(effectiveCap);
  warnings.push(...localWarnings);

  let buffer: ResultRow[] = [];
  let scanned = 0;
  let matched = 0;
  let totalRows = 0;
  const effectiveOutLimit = Math.min(plan.limit, opts.hardLimit);
  const stream = q.stream();

  const flush = async (final: boolean): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    await opts.onBatch(batch, {
      rowIndexStart: totalRows - batch.length,
      truncated: final && (scanned >= effectiveCap || totalRows >= effectiveOutLimit),
    });
  };

  await consumeStream(stream, opts.signal, async (snap) => {
    scanned += 1;
    const row = serializeDoc(snap);
    if (!plan.postFilters.every((f) => matchesPostFilter(row, f))) return 'continue';
    matched += 1;
    buffer.push(row);
    totalRows += 1;
    if (totalRows >= effectiveOutLimit) {
      await flush(true);
      return 'done';
    }
    if (buffer.length >= opts.batchSize) {
      await flush(false);
    }
    return 'continue';
  });
  await flush(true);

  if (scanned >= effectiveCap) {
    warnings.push(
      `Scan hit the cap of ${effectiveCap} documents; results may be incomplete.`,
    );
  }

  return {
    ok: true,
    totalRows,
    scanned,
    matched,
    truncated: scanned >= effectiveCap || totalRows >= effectiveOutLimit,
    warnings,
    elapsedMs: now() - started,
  };
}

/**
 * Iterate a `q.stream()` Node Readable, calling `onDoc` for each
 * snapshot and honoring its `'done'` signal + an optional AbortSignal.
 * Internally pauses the stream while `onDoc` is awaited so backpressure
 * propagates all the way back to the gRPC channel.
 */
function consumeStream(
  stream: NodeJS.ReadableStream,
  signal: AbortSignal | undefined,
  onDoc: (snap: unknown) => Promise<'continue' | 'done'>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      try {
        (stream as unknown as { destroy?: (err?: Error) => void }).destroy?.();
      } catch {
        /* ignore */
      }
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve();
    };

    const onAbort = () => finish(new Error('ABORTED'));
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    stream.on('error', (err: unknown) => finish(err));
    stream.on('end', () => finish());
    stream.on('data', (snap: unknown) => {
      if (settled) return;
      (stream as unknown as { pause?: () => void }).pause?.();
      onDoc(snap)
        .then((sig) => {
          if (settled) return;
          if (sig === 'done') finish();
          else (stream as unknown as { resume?: () => void }).resume?.();
        })
        .catch((err) => finish(err));
    });
  });
}
