import type { WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { StreamEventChannels } from '@shared/types/ipc';
import type {
  StreamBatchEvent,
  StreamDoneEvent,
  StreamErrorEvent,
  ExportProgressEvent,
  ExportDoneEvent,
  ExportErrorEvent,
} from '@shared/types/ipc';

export interface ActiveRun {
  runId: string;
  abortController: AbortController;
  target: WebContents;
  /** Maximum bytes buffered across outstanding batches before we abort. */
  memoryLimitBytes: number;
  bytesOutstanding: number;
  createdAt: number;
}

const runs = new Map<string, ActiveRun>();

export function createRun(target: WebContents, memoryLimitMb: number): ActiveRun {
  const run: ActiveRun = {
    runId: randomUUID(),
    abortController: new AbortController(),
    target,
    memoryLimitBytes: Math.max(8, memoryLimitMb) * 1024 * 1024,
    bytesOutstanding: 0,
    createdAt: Date.now(),
  };
  runs.set(run.runId, run);
  target.once('destroyed', () => {
    run.abortController.abort();
    runs.delete(run.runId);
  });
  return run;
}

export function getRun(runId: string): ActiveRun | undefined {
  return runs.get(runId);
}

export function cancelRun(runId: string): boolean {
  const run = runs.get(runId);
  if (!run) return false;
  run.abortController.abort();
  return true;
}

export function endRun(runId: string): void {
  runs.delete(runId);
}

function approxBatchBytes(batch: StreamBatchEvent): number {
  // Cheap O(rows) estimate: sum the rough JSON length of each cell. We
  // intentionally avoid `JSON.stringify(batch)` on the hot path — that
  // would double the per-batch CPU cost.
  let size = 128;
  for (const row of batch.rows) {
    for (const cell of row) {
      if (cell === null || cell === undefined) {
        size += 4;
        continue;
      }
      const t = typeof cell;
      if (t === 'string') size += (cell as string).length + 2;
      else if (t === 'number' || t === 'boolean') size += 8;
      else size += JSON.stringify(cell).length;
    }
  }
  return size;
}

export function sendBatch(run: ActiveRun, batch: StreamBatchEvent): void {
  if (run.target.isDestroyed()) {
    run.abortController.abort();
    return;
  }
  const bytes = approxBatchBytes(batch);
  run.bytesOutstanding += bytes;
  if (run.bytesOutstanding > run.memoryLimitBytes) {
    run.abortController.abort();
    return;
  }
  run.target.send(StreamEventChannels.batch(run.runId), batch);
  // Release the memory accounting after a microtask; Electron has already
  // serialized the payload by then.
  setImmediate(() => {
    run.bytesOutstanding = Math.max(0, run.bytesOutstanding - bytes);
  });
}

export function sendDone(run: ActiveRun, done: StreamDoneEvent): void {
  if (!run.target.isDestroyed()) {
    run.target.send(StreamEventChannels.done(run.runId), done);
  }
  endRun(run.runId);
}

export function sendError(run: ActiveRun, err: StreamErrorEvent): void {
  if (!run.target.isDestroyed()) {
    run.target.send(StreamEventChannels.error(run.runId), err);
  }
  endRun(run.runId);
}

export function sendExportProgress(run: ActiveRun, evt: ExportProgressEvent): void {
  if (run.target.isDestroyed()) {
    run.abortController.abort();
    return;
  }
  run.target.send(StreamEventChannels.exportProgress(run.runId), evt);
}

export function sendExportDone(run: ActiveRun, evt: ExportDoneEvent): void {
  if (!run.target.isDestroyed()) {
    run.target.send(StreamEventChannels.exportDone(run.runId), evt);
  }
  endRun(run.runId);
}

export function sendExportError(run: ActiveRun, evt: ExportErrorEvent): void {
  if (!run.target.isDestroyed()) {
    run.target.send(StreamEventChannels.exportError(run.runId), evt);
  }
  endRun(run.runId);
}
