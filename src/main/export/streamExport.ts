import { createWriteStream, WriteStream } from 'node:fs';
import { BrowserWindow, dialog, type WebContents } from 'electron';
import type {
  ExportStartRequest,
  ExportStartOutcome,
  ExportFormat,
  ExportProgressEvent,
  ExportDoneEvent,
  ExportErrorEvent,
} from '@shared/types/ipc';
import type { SqlCell, SqlColumn } from '../drivers/types';
import type { ResultRow } from '@shared/types/results';
import {
  getSqlDriverForActive,
  getHandleForActive,
} from '../firestore/connectionManager';
import { getProfile } from '../profiles/profileStore';
import { isFirestoreProfile } from '@shared/types/profile';
import { ensureSchema } from '../firestore/schemaCache';
import { runPlanStream } from '../firestore/streamExecutor';
import { createRun, type ActiveRun } from '../ipc/streamRuns';

export interface ExportCallbacks {
  sendProgress: (run: ActiveRun, evt: ExportProgressEvent) => void;
  sendDone: (run: ActiveRun, evt: ExportDoneEvent) => void;
  sendError: (run: ActiveRun, evt: ExportErrorEvent) => void;
}

function defaultExtension(format: ExportFormat): string {
  switch (format) {
    case 'csv':
      return 'csv';
    case 'ndjson':
      return 'ndjson';
    case 'json-array':
      return 'json';
  }
}

function csvEscape(cell: SqlCell | undefined | null): string {
  if (cell === null || cell === undefined) return '';
  let s: string;
  if (typeof cell === 'string') s = cell;
  else if (typeof cell === 'number' || typeof cell === 'boolean') s = String(cell);
  else s = JSON.stringify(cell);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

interface WriterState {
  stream: WriteStream;
  format: ExportFormat;
  columns: SqlColumn[];
  rowsWritten: number;
  bytesWritten: number;
  wroteHeader: boolean;
  wroteFirstJson: boolean;
}

async function writeChunk(state: WriterState, chunk: string): Promise<void> {
  const buf = Buffer.from(chunk, 'utf8');
  state.bytesWritten += buf.byteLength;
  if (!state.stream.write(buf)) {
    await new Promise<void>((resolve) => state.stream.once('drain', () => resolve()));
  }
}

async function writeHeader(state: WriterState): Promise<void> {
  if (state.wroteHeader) return;
  state.wroteHeader = true;
  switch (state.format) {
    case 'csv': {
      const header = state.columns.map((c) => csvEscape(c.name)).join(',') + '\n';
      await writeChunk(state, header);
      break;
    }
    case 'json-array':
      await writeChunk(state, '[');
      break;
    case 'ndjson':
      // no header
      break;
  }
}

async function writeTupleRow(state: WriterState, row: SqlCell[]): Promise<void> {
  switch (state.format) {
    case 'csv': {
      const line = row.map(csvEscape).join(',') + '\n';
      await writeChunk(state, line);
      break;
    }
    case 'ndjson': {
      const obj: Record<string, SqlCell> = {};
      for (let i = 0; i < state.columns.length; i += 1) {
        obj[state.columns[i].name] = row[i] ?? null;
      }
      await writeChunk(state, `${JSON.stringify(obj)}\n`);
      break;
    }
    case 'json-array': {
      const obj: Record<string, SqlCell> = {};
      for (let i = 0; i < state.columns.length; i += 1) {
        obj[state.columns[i].name] = row[i] ?? null;
      }
      const prefix = state.wroteFirstJson ? ',' : '';
      state.wroteFirstJson = true;
      await writeChunk(state, `${prefix}${JSON.stringify(obj)}`);
      break;
    }
  }
  state.rowsWritten += 1;
}

async function writeFirestoreRow(state: WriterState, row: ResultRow): Promise<void> {
  switch (state.format) {
    case 'csv': {
      // CSV dump of Firestore rows is intentionally flat: id, path, data.
      const line = `${csvEscape(row.id)},${csvEscape(row.path)},${csvEscape(
        JSON.stringify(row.data) as unknown as SqlCell,
      )}\n`;
      await writeChunk(state, line);
      break;
    }
    case 'ndjson':
      await writeChunk(state, `${JSON.stringify(row)}\n`);
      break;
    case 'json-array': {
      const prefix = state.wroteFirstJson ? ',' : '';
      state.wroteFirstJson = true;
      await writeChunk(state, `${prefix}${JSON.stringify(row)}`);
      break;
    }
  }
  state.rowsWritten += 1;
}

async function finalize(state: WriterState): Promise<void> {
  if (state.format === 'json-array') {
    await writeChunk(state, ']');
  }
  await new Promise<void>((resolve, reject) => {
    state.stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

async function pickSavePath(
  sender: WebContents,
  suggested: string,
): Promise<string | null> {
  const browserWindow = BrowserWindow.fromWebContents(sender) ?? undefined;
  const result = browserWindow
    ? await dialog.showSaveDialog(browserWindow, { defaultPath: suggested })
    : await dialog.showSaveDialog({ defaultPath: suggested });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

export async function startExport(
  input: ExportStartRequest,
  sender: WebContents,
  cb: ExportCallbacks,
): Promise<ExportStartOutcome> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const suggestedName = `fqs-export-${ts}.${defaultExtension(input.format)}`;
  let path = input.path;
  if (!path) {
    const picked = await pickSavePath(sender, suggestedName);
    if (!picked) {
      return {
        ok: false as const,
        code: 'USER_CANCELED',
        message: 'Export canceled.',
        canceled: true,
      };
    }
    path = picked;
  }

  if (input.source === 'sql') {
    return startSqlExport(input, path, sender, cb);
  }
  return startFirestoreExport(input, path, sender, cb);
}

async function startSqlExport(
  input: Extract<ExportStartRequest, { source: 'sql' }>,
  path: string,
  sender: WebContents,
  cb: ExportCallbacks,
): Promise<ExportStartOutcome> {
  let driver;
  try {
    driver = await getSqlDriverForActive();
  } catch (err) {
    return {
      ok: false as const,
      code: 'NO_SQL_PROFILE',
      message: err instanceof Error ? err.message : String(err),
      canceled: false,
    };
  }
  const memoryMb = (driver.profile as { maxMemoryMb?: number }).maxMemoryMb ?? 512;
  const run = createRun(sender, memoryMb);
  const runId = run.runId;
  const started = Date.now();
  const hardLimit = Math.max(
    1,
    Math.min(input.hardLimit ?? driver.profile.defaultLimit, driver.profile.defaultLimit),
  );
  const stream = createWriteStream(path);
  const state: WriterState = {
    stream,
    format: input.format,
    columns: [],
    rowsWritten: 0,
    bytesWritten: 0,
    wroteHeader: false,
    wroteFirstJson: false,
  };

  void (async () => {
    try {
      const outcome = await driver.streamReadOnlyQuery(input.sql, {
        hardLimit,
        batchSize: 5_000,
        signal: run.abortController.signal,
        onBatch: async (rows, meta) => {
          if (run.abortController.signal.aborted) return;
          if (!state.wroteHeader) {
            state.columns = meta.columns ?? state.columns;
            await writeHeader(state);
          }
          for (const row of rows) {
            await writeTupleRow(state, row);
          }
          cb.sendProgress(run, {
            runId,
            rowsWritten: state.rowsWritten,
            bytesWritten: state.bytesWritten,
          });
        },
      });
      if (!outcome.ok) {
        stream.destroy();
        cb.sendError(run, {
          runId,
          code: outcome.code,
          message: outcome.message,
          elapsedMs: Date.now() - started,
        });
        return;
      }
      await finalize(state);
      cb.sendDone(run, {
        runId,
        path,
        rowsWritten: state.rowsWritten,
        bytesWritten: state.bytesWritten,
        elapsedMs: Date.now() - started,
        truncated: outcome.truncated,
      });
    } catch (err) {
      stream.destroy();
      cb.sendError(run, {
        runId,
        code: 'EXPORT_FAILED',
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - started,
      });
    }
  })();

  return { ok: true as const, runId, path, format: input.format };
}

async function startFirestoreExport(
  input: Extract<ExportStartRequest, { source: 'firestore' }>,
  path: string,
  sender: WebContents,
  cb: ExportCallbacks,
): Promise<ExportStartOutcome> {
  let handle;
  try {
    handle = await getHandleForActive();
  } catch (err) {
    return {
      ok: false as const,
      code: 'NO_FIRESTORE_PROFILE',
      message: err instanceof Error ? err.message : String(err),
      canceled: false,
    };
  }
  const profile = await getProfile(handle.profileId);
  const firestoreProfile =
    profile && isFirestoreProfile(profile) ? profile : null;
  const profileScanCap = firestoreProfile?.scanCap ?? 500;
  const profileSampleSize = firestoreProfile?.sampleSize ?? 10;
  const memoryMb = firestoreProfile?.maxMemoryMb ?? 512;
  const hardLimit = Math.max(1, Math.min(input.hardLimit ?? 1_000_000, 10_000_000));

  const run = createRun(sender, memoryMb);
  const runId = run.runId;
  const started = Date.now();
  const stream = createWriteStream(path);
  const state: WriterState = {
    stream,
    format: input.format,
    // Firestore "columns" are synthetic — id, path, data.
    columns: [
      { name: '__id', dataType: 'string' },
      { name: '__path', dataType: 'string' },
      { name: 'data', dataType: 'json' },
    ],
    rowsWritten: 0,
    bytesWritten: 0,
    wroteHeader: false,
    wroteFirstJson: false,
  };

  void (async () => {
    try {
      await writeHeader(state);
      const outcome = await runPlanStream(
        {
          firestore: handle.firestore,
          profileScanCap,
          getSchema: (collection, collectionGroup) =>
            ensureSchema({
              profileId: handle.profileId,
              firestore: handle.firestore,
              collection,
              collectionGroup,
              sampleSize: profileSampleSize,
            }),
        },
        input.plan,
        {
          hardLimit,
          batchSize: 5_000,
          signal: run.abortController.signal,
          onBatch: async (rows) => {
            if (run.abortController.signal.aborted) return;
            for (const row of rows) {
              await writeFirestoreRow(state, row);
            }
            cb.sendProgress(run, {
              runId,
              rowsWritten: state.rowsWritten,
              bytesWritten: state.bytesWritten,
            });
          },
        },
      );
      if (!outcome.ok) {
        stream.destroy();
        cb.sendError(run, {
          runId,
          code: outcome.code,
          message: outcome.message,
          elapsedMs: Date.now() - started,
        });
        return;
      }
      await finalize(state);
      cb.sendDone(run, {
        runId,
        path,
        rowsWritten: state.rowsWritten,
        bytesWritten: state.bytesWritten,
        elapsedMs: Date.now() - started,
        truncated: outcome.truncated,
      });
    } catch (err) {
      stream.destroy();
      cb.sendError(run, {
        runId,
        code: 'EXPORT_FAILED',
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - started,
      });
    }
  })();

  return { ok: true as const, runId, path, format: input.format };
}
