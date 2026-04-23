import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipcClient';
import type {
  StreamBatchEvent,
  StreamDoneEvent,
  StreamErrorEvent,
} from '@shared/types/ipc';

export type StreamSource =
  | { kind: 'sql'; sql: string }
  | { kind: 'firestore'; plan: import('@shared/types/plan').QueryPlan };

export interface RowStreamOpts {
  uiLimit?: number;
  hardLimit?: number;
  batchSize?: number;
  /** Column key hint used for Firestore runs so the renderer columns are stable. */
  onBatch?: (batch: StreamBatchEvent) => void;
  onDone?: (evt: StreamDoneEvent) => void;
  onError?: (evt: StreamErrorEvent) => void;
}

export interface RowStreamColumn {
  name: string;
  dataType?: string;
}

export interface RowStreamState {
  runId: string | null;
  running: boolean;
  columns: RowStreamColumn[];
  rows: unknown[][];
  totalRows: number;
  deliveredRows: number;
  truncated: boolean;
  uiTruncated: boolean;
  elapsedMs: number;
  warnings: string[];
  error: { code: string; message: string } | null;
}

const INITIAL: RowStreamState = {
  runId: null,
  running: false,
  columns: [],
  rows: [],
  totalRows: 0,
  deliveredRows: 0,
  truncated: false,
  uiTruncated: false,
  elapsedMs: 0,
  warnings: [],
  error: null,
};

/**
 * Streamed-query hook. Owns a bounded row-window store (up to
 * `uiLimit` rows, default 50k) and replays IPC batch events into it
 * synchronously so `@tanstack/react-virtual` can scroll a million
 * rows without blowing the heap.
 *
 * `start(source)` kicks off a new run; any previous run is canceled
 * first to avoid stacking listeners. The returned `cancel()` aborts
 * the in-flight run on both Electron and web shells.
 */
export function useRowStream(opts: RowStreamOpts = {}): RowStreamState & {
  start: (source: StreamSource) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<RowStreamState>(INITIAL);
  const unsubRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef<string | null>(null);
  const rowsRef = useRef<unknown[][]>([]);
  const columnsRef = useRef<RowStreamColumn[]>([]);

  const cleanup = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
  }, []);

  const cancel = useCallback(async () => {
    const current = runIdRef.current;
    cleanup();
    if (current) {
      try {
        await ipc.streams.cancel(current);
      } catch {
        /* swallow — the run may already be done */
      }
    }
    runIdRef.current = null;
    setState((s) => ({ ...s, running: false }));
  }, [cleanup]);

  const reset = useCallback(() => {
    rowsRef.current = [];
    columnsRef.current = [];
    setState(INITIAL);
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
      const current = runIdRef.current;
      if (current) {
        void ipc.streams.cancel(current).catch(() => undefined);
      }
    };
  }, [cleanup]);

  const start = useCallback(
    async (source: StreamSource) => {
      await cancel();
      rowsRef.current = [];
      columnsRef.current = [];
      setState({ ...INITIAL, running: true });

      const uiLimit = opts.uiLimit ?? 50_000;
      const hardLimit = opts.hardLimit ?? uiLimit;
      const batchSize = opts.batchSize ?? 5_000;

      const startResult =
        source.kind === 'sql'
          ? await ipc.streams.sqlStart({
              sql: source.sql,
              uiLimit,
              hardLimit,
              batchSize,
            })
          : await ipc.streams.executeStart({
              plan: source.plan,
              uiLimit,
              hardLimit,
              batchSize,
            });
      if (!startResult.ok) {
        setState((s) => ({
          ...s,
          running: false,
          error: { code: startResult.code, message: startResult.message },
        }));
        return;
      }
      const runId = startResult.runId;
      runIdRef.current = runId;
      setState((s) => ({ ...s, runId }));

      unsubRef.current = ipc.streams.subscribe(runId, {
        onBatch: (evt: unknown) => {
          const batch = evt as StreamBatchEvent;
          if (batch.columns && columnsRef.current.length === 0) {
            columnsRef.current = batch.columns;
          }
          // Append rows; only up to `uiLimit` (the driver has already
          // clamped but we double-check here for the web shim).
          const remaining = uiLimit - rowsRef.current.length;
          if (remaining <= 0) return;
          const toAdd =
            batch.rows.length > remaining ? batch.rows.slice(0, remaining) : batch.rows;
          for (const row of toAdd) rowsRef.current.push(row);
          setState((s) => ({
            ...s,
            rows: rowsRef.current,
            columns: columnsRef.current,
            deliveredRows: rowsRef.current.length,
          }));
          opts.onBatch?.(batch);
        },
        onDone: (evt: unknown) => {
          const done = evt as StreamDoneEvent;
          setState((s) => ({
            ...s,
            running: false,
            totalRows: done.totalRows,
            deliveredRows: done.deliveredRows,
            truncated: done.truncated,
            uiTruncated: done.uiTruncated,
            elapsedMs: done.elapsedMs,
            warnings: done.warnings,
          }));
          runIdRef.current = null;
          cleanup();
          opts.onDone?.(done);
        },
        onError: (evt: unknown) => {
          const err = evt as StreamErrorEvent;
          setState((s) => ({
            ...s,
            running: false,
            error: { code: err.code, message: err.message },
            elapsedMs: err.elapsedMs,
          }));
          runIdRef.current = null;
          cleanup();
          opts.onError?.(err);
        },
      });
    },
    [cancel, cleanup, opts],
  );

  return { ...state, start, cancel, reset };
}
