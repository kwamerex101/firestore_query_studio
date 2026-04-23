import type {
  ExecuteStreamStartRequest,
  ExecuteStreamStartOutcome,
  ExportStartOutcome,
  ExportStartRequest,
  SqlStreamStartOutcome,
  SqlStreamStartRequest,
  StreamBatchEvent,
  StreamDoneEvent,
  StreamErrorEvent,
  ExportDoneEvent,
  ExportErrorEvent,
  ExportProgressEvent,
} from '@shared/types/ipc';
import { runPlan } from './executor';

/**
 * Browser shim for the streaming IPC. The web build has no main
 * process, so we can't wire a true cursor stream — instead we run the
 * existing one-shot Firebase Web executor and replay its result in
 * batches keyed by a fake runId so the renderer's `useRowStream` hook
 * works the same way across transports.
 *
 * SQL streaming is unsupported in the browser (no TCP socket) and
 * returns an error outcome. `startExport` likewise falls back to an
 * in-memory blob download via `FileSaver`-style approach.
 */

interface Subscriber {
  onBatch?: (evt: unknown) => void;
  onDone?: (evt: unknown) => void;
  onError?: (evt: unknown) => void;
}

interface ExportSubscriber {
  onProgress?: (evt: unknown) => void;
  onDone?: (evt: unknown) => void;
  onError?: (evt: unknown) => void;
}

const streamSubs = new Map<string, Subscriber>();
const streamCancels = new Map<string, AbortController>();
const exportSubs = new Map<string, ExportSubscriber>();
const exportCancels = new Map<string, AbortController>();

function nextRunId(): string {
  return `web-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

export function streamSubscribe(runId: string, handlers: Subscriber): () => void {
  streamSubs.set(runId, handlers);
  return () => {
    streamSubs.delete(runId);
  };
}

export function exportSubscribe(runId: string, handlers: ExportSubscriber): () => void {
  exportSubs.set(runId, handlers);
  return () => {
    exportSubs.delete(runId);
  };
}

export async function streamCancel(runId: string): Promise<{ ok: true }> {
  streamCancels.get(runId)?.abort();
  streamCancels.delete(runId);
  return { ok: true };
}

export async function exportCancel(runId: string): Promise<{ ok: true }> {
  exportCancels.get(runId)?.abort();
  exportCancels.delete(runId);
  return { ok: true };
}

export async function streamSqlStart(
  _req: SqlStreamStartRequest,
): Promise<SqlStreamStartOutcome> {
  return {
    ok: false as const,
    code: 'UNSUPPORTED',
    message:
      'SQL streaming is only available in the desktop app. Web profiles are Firestore-only.',
  };
}

export async function streamExecuteStart(
  req: ExecuteStreamStartRequest,
): Promise<ExecuteStreamStartOutcome> {
  const runId = nextRunId();
  const uiLimit = Math.max(1, Math.min(req.uiLimit ?? 50_000, 200_000));
  const hardLimit = Math.max(uiLimit, Math.min(req.hardLimit ?? uiLimit, 10_000_000));
  const batchSize = Math.max(100, Math.min(req.batchSize ?? 5_000, 50_000));
  const controller = new AbortController();
  streamCancels.set(runId, controller);

  // Kick off the run on a microtask so we return the runId first.
  queueMicrotask(async () => {
    const sub = streamSubs.get(runId);
    if (!sub) return;
    try {
      const outcome = await runPlan(req.plan);
      if (controller.signal.aborted) {
        const err: StreamErrorEvent = {
          runId,
          code: 'ABORTED',
          message: 'Stream canceled.',
          elapsedMs: 0,
        };
        sub.onError?.(err);
        return;
      }
      if (!outcome.ok) {
        const err: StreamErrorEvent = {
          runId,
          code: outcome.code ?? 'EXECUTION_ERROR',
          message: outcome.message ?? 'Query failed.',
          elapsedMs: 0,
        };
        sub.onError?.(err);
        return;
      }
      const rows = outcome.rows ?? [];
      const capped = rows.slice(0, uiLimit);
      for (let i = 0; i < capped.length; i += batchSize) {
        if (controller.signal.aborted) break;
        const slice = capped.slice(i, i + batchSize);
        const batch: StreamBatchEvent = {
          runId,
          rowIndexStart: i,
          rows: slice.map((r) => [r.id, r.path, r.data]),
          columns:
            i === 0
              ? [
                  { name: '__id', dataType: 'string' },
                  { name: '__path', dataType: 'string' },
                  { name: 'data', dataType: 'json' },
                ]
              : undefined,
        };
        sub.onBatch?.(batch);
        await new Promise((r) => setTimeout(r, 0));
      }
      const done: StreamDoneEvent = {
        runId,
        totalRows: rows.length,
        deliveredRows: capped.length,
        elapsedMs: outcome.stats?.durationMs ?? 0,
        truncated: outcome.stats?.truncated ?? false,
        uiTruncated: rows.length > uiLimit,
        warnings: outcome.warnings ?? [],
      };
      sub.onDone?.(done);
    } catch (err) {
      const errEvt: StreamErrorEvent = {
        runId,
        code: 'EXECUTION_ERROR',
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: 0,
      };
      sub.onError?.(errEvt);
    } finally {
      streamCancels.delete(runId);
    }
  });
  // Void-use the unused import check
  void hardLimit;
  return { ok: true as const, runId, uiLimit, hardLimit };
}

export async function exportStart(
  req: ExportStartRequest,
): Promise<ExportStartOutcome> {
  if (req.source === 'sql') {
    return {
      ok: false as const,
      code: 'UNSUPPORTED',
      message: 'SQL export is only available in the desktop app.',
      canceled: false,
    };
  }
  const runId = nextRunId();
  const controller = new AbortController();
  exportCancels.set(runId, controller);
  const format = req.format;
  const suggestedName = `fqs-export-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.${format === 'json-array' ? 'json' : format}`;

  queueMicrotask(async () => {
    const sub = exportSubs.get(runId);
    if (!sub) return;
    const started = Date.now();
    try {
      const outcome = await runPlan(req.plan);
      if (!outcome.ok) {
        const err: ExportErrorEvent = {
          runId,
          code: outcome.code ?? 'EXECUTION_ERROR',
          message: outcome.message ?? 'Query failed.',
          elapsedMs: Date.now() - started,
        };
        sub.onError?.(err);
        return;
      }
      const rows = outcome.rows ?? [];
      let text = '';
      if (format === 'csv') {
        text = 'id,path,data\n';
        for (const r of rows) {
          text += `${csvEscape(r.id)},${csvEscape(r.path)},${csvEscape(
            JSON.stringify(r.data),
          )}\n`;
          if (controller.signal.aborted) break;
        }
      } else if (format === 'ndjson') {
        for (const r of rows) {
          text += `${JSON.stringify(r)}\n`;
          if (controller.signal.aborted) break;
        }
      } else {
        text = '[';
        rows.forEach((r, i) => {
          text += `${i === 0 ? '' : ','}${JSON.stringify(r)}`;
        });
        text += ']';
      }
      const blob = new Blob([text], {
        type:
          format === 'csv'
            ? 'text/csv'
            : format === 'ndjson'
              ? 'application/x-ndjson'
              : 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedName;
      a.click();
      URL.revokeObjectURL(url);
      const progress: ExportProgressEvent = {
        runId,
        rowsWritten: rows.length,
        bytesWritten: blob.size,
      };
      sub.onProgress?.(progress);
      const done: ExportDoneEvent = {
        runId,
        path: suggestedName,
        rowsWritten: rows.length,
        bytesWritten: blob.size,
        elapsedMs: Date.now() - started,
        truncated: outcome.stats?.truncated ?? false,
      };
      sub.onDone?.(done);
    } catch (err) {
      const e: ExportErrorEvent = {
        runId,
        code: 'EXPORT_FAILED',
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - started,
      };
      sub.onError?.(e);
    } finally {
      exportCancels.delete(runId);
    }
  });
  return { ok: true as const, runId, path: suggestedName, format };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
