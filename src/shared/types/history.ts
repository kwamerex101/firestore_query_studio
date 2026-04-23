import { z } from 'zod';
import { QueryPlan } from './plan';
import { RunOutcome } from './results';
import { SqlPlan } from './sqlPlan';
import { SqlExecuteOutcome } from './sqlExecute';

const rowsTruncatedField = z.boolean().default(false);

/**
 * Persisted Firestore query history. `kind` is optional on disk for legacy
 * files created before the SQL path existed — `HistoryEntry` parsing adds it.
 */
export const FirestoreHistoryEntry = z.object({
  kind: z.literal('firestore'),
  id: z.string().min(1),
  profileId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  question: z.string().min(1),
  collection: z.string().optional(),
  plan: QueryPlan,
  outcome: RunOutcome,
  rowsTruncated: rowsTruncatedField,
});
export type FirestoreHistoryEntry = z.infer<typeof FirestoreHistoryEntry>;

/**
 * Relational (Postgres / MySQL / SQL Server) NL→SQL or manual runs.
 */
export const SqlHistoryEntry = z.object({
  kind: z.literal('sql'),
  id: z.string().min(1),
  profileId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  question: z.string().min(1),
  sqlPlan: SqlPlan,
  outcome: SqlExecuteOutcome,
  rowsTruncated: rowsTruncatedField,
});
export type SqlHistoryEntry = z.infer<typeof SqlHistoryEntry>;

const LegacyFirestoreHistoryEntry = z
  .object({
    id: z.string().min(1),
    profileId: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    question: z.string().min(1),
    collection: z.string().optional(),
    plan: QueryPlan,
    outcome: RunOutcome,
    rowsTruncated: rowsTruncatedField,
  })
  .strict()
  .transform((e) => ({ ...e, kind: 'firestore' as const }));

/**
 * `HistoryEntry` union. Legacy entries (no `kind` field) are read as Firestore.
 */
export const HistoryEntry = z.union([
  FirestoreHistoryEntry,
  SqlHistoryEntry,
  LegacyFirestoreHistoryEntry,
]);
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export function isSqlHistoryEntry(e: HistoryEntry): e is SqlHistoryEntry {
  return (e as SqlHistoryEntry).kind === 'sql';
}

export function isFirestoreHistoryEntry(
  e: HistoryEntry,
): e is FirestoreHistoryEntry {
  return !isSqlHistoryEntry(e);
}

export const HistoryList = z.array(HistoryEntry);
export type HistoryList = z.infer<typeof HistoryList>;

/**
 * Lightweight summary used by list endpoints so we don't ship
 * every row across IPC when the user just wants to browse.
 */
export const HistorySummary = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  question: z.string().min(1),
  collection: z.string().optional(),
  /**
   * Firestore plan mode, or "sql" for relational runs.
   */
  mode: z.enum(['query', 'scan', 'multi', 'sql']),
  ok: z.boolean(),
  rowsReturned: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  /**
   * Short copy of the SQL (relational only) for search + row subtitles.
   */
  sqlPreview: z.string().optional(),
});
export type HistorySummary = z.infer<typeof HistorySummary>;
