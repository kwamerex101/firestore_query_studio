import type {
  HistoryAddRequest,
  HistoryAddResult,
  HistoryClearResult,
  HistoryFindCachedRequest,
  HistoryFindCachedResult,
  HistoryGetRequest,
  HistoryGetResult,
  HistoryListRequest,
  HistoryListResult,
} from '@shared/types/ipc';
import {
  HistoryEntry,
  HistorySummary,
  isSqlHistoryEntry,
  type HistoryEntry as HistoryEntryType,
} from '@shared/types/history';
import { getDb } from './db';
import { getActiveProfileId } from './profiles';

/**
 * History storage for the web shell. Mirrors the behaviour of
 * `src/main/history/historyStore.ts` as closely as practical:
 *   - one row per completed run, keyed by UUID.
 *   - indexed by createdAt (DESC) for `list`.
 *   - indexed by a cache key `<question>|<collection>` for `findCached`.
 *
 * Like the desktop shell, we cap per-entry rows to `MAX_ROWS_PER_ENTRY`
 * so a single 500k-row stream doesn't bloat IndexedDB past its soft
 * quota and crash the tab on next load. The full payload still lives
 * as a one-shot download via the export-to-disk path.
 */

const DEFAULT_LIST_LIMIT = 100;
const MAX_ROWS_PER_ENTRY = 200;
const MAX_ENTRIES = 500;

function sqlPreviewText(sql: string, max = 200): string {
  const t = sql.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function truncateOutcomeRows(entry: HistoryEntryType): HistoryEntryType {
  if (isSqlHistoryEntry(entry)) {
    if (!entry.outcome.ok) return entry;
    if (entry.outcome.rows.length <= MAX_ROWS_PER_ENTRY) return entry;
    return {
      ...entry,
      rowsTruncated: true,
      outcome: {
        ...entry.outcome,
        rows: entry.outcome.rows.slice(0, MAX_ROWS_PER_ENTRY),
      },
    };
  }
  if (!entry.outcome.ok) return entry;
  if (entry.outcome.rows.length <= MAX_ROWS_PER_ENTRY) return entry;
  return {
    ...entry,
    rowsTruncated: true,
    outcome: {
      ...entry.outcome,
      rows: entry.outcome.rows.slice(0, MAX_ROWS_PER_ENTRY),
    },
  };
}

function toSummary(entry: HistoryEntryType): HistorySummary {
  if (isSqlHistoryEntry(entry)) {
    return {
      id: entry.id,
      profileId: entry.profileId,
      createdAt: entry.createdAt,
      question: entry.question,
      collection: undefined,
      mode: 'sql',
      ok: entry.outcome.ok,
      rowsReturned: entry.outcome.ok ? entry.outcome.rows.length : 0,
      durationMs: entry.outcome.elapsedMs,
      sqlPreview: sqlPreviewText(entry.sqlPlan.sql),
    };
  }
  return {
    id: entry.id,
    profileId: entry.profileId,
    createdAt: entry.createdAt,
    question: entry.question,
    collection: entry.collection,
    mode: entry.outcome.ok ? entry.outcome.stats.mode : entry.plan.mode,
    ok: entry.outcome.ok,
    rowsReturned: entry.outcome.ok ? entry.outcome.rows.length : 0,
    durationMs: entry.outcome.ok ? entry.outcome.stats.durationMs : 0,
  };
}

function makeCacheKey(
  question: string,
  collection: string | undefined,
): string {
  return `${question.trim().toLowerCase()}|${(collection ?? '').trim().toLowerCase()}`;
}

export async function historyList(
  req?: HistoryListRequest,
): Promise<HistoryListResult> {
  const limit = req?.limit ?? DEFAULT_LIST_LIMIT;
  const activeProfileId = await getActiveProfileId();
  if (!activeProfileId) return { entries: [] };
  const db = await getDb();
  // `getAll` on the index is ordered ASC by createdAt; we reverse + slice
  // for the DESC-most-recent-N behaviour the UI wants.
  const rows = (await db.getAllFromIndex('history', 'by-createdAt'))
    .filter(
      (row) => (row.payload as HistoryEntryType).profileId === activeProfileId,
    );
  const sorted = rows.reverse().slice(0, limit);
  const entries: HistorySummary[] = sorted.map((row) => {
    const entry = HistoryEntry.parse(row.payload);
    return toSummary(entry);
  });
  return { entries };
}

export async function historyGet(
  req: HistoryGetRequest,
): Promise<HistoryGetResult> {
  const activeProfileId = await getActiveProfileId();
  if (!activeProfileId) return { entry: null };
  const db = await getDb();
  const row = await db.get('history', req.id);
  if (!row) return { entry: null };
  const entry = HistoryEntry.parse(row.payload);
  if (entry.profileId !== activeProfileId) return { entry: null };
  return { entry };
}

export async function historyAdd(
  req: HistoryAddRequest,
): Promise<HistoryAddResult> {
  const profileId = await getActiveProfileId();
  if (!profileId) {
    throw new Error('No active profile — cannot save history.');
  }
  const base = {
    id: crypto.randomUUID(),
    profileId,
    createdAt: Date.now(),
    rowsTruncated: false,
  } as const;
  const parsed: HistoryEntryType = HistoryEntry.parse(
    req.source === 'sql'
      ? {
          ...base,
          kind: 'sql' as const,
          question: req.question,
          sqlPlan: req.sqlPlan,
          outcome: req.outcome,
        }
      : {
          ...base,
          kind: 'firestore' as const,
          question: req.question,
          collection: req.collection,
          plan: req.plan,
          outcome: req.outcome,
        },
  );
  const entry = truncateOutcomeRows(parsed);
  const db = await getDb();
  await db.put('history', {
    id: entry.id,
    createdAt: entry.createdAt,
    payload: entry,
    cacheKey: makeCacheKey(
      entry.question,
      isSqlHistoryEntry(entry) ? undefined : entry.collection,
    ),
  });
  // Enforce a soft cap on the number of entries so IndexedDB doesn't
  // grow unbounded across months of usage. Using the `by-createdAt`
  // index keeps this O(overage) instead of O(total).
  const all = await db.getAllFromIndex('history', 'by-createdAt');
  if (all.length > MAX_ENTRIES) {
    const toRemove = all
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, all.length - MAX_ENTRIES);
    for (const row of toRemove) {
      await db.delete('history', row.id);
    }
  }
  return { entry };
}

export async function historyClear(): Promise<HistoryClearResult> {
  const activeProfileId = await getActiveProfileId();
  if (!activeProfileId) return { cleared: 0 };
  const db = await getDb();
  const rows = await db.getAll('history');
  let cleared = 0;
  for (const row of rows) {
    const entry = HistoryEntry.parse(row.payload);
    if (entry.profileId === activeProfileId) {
      await db.delete('history', row.id);
      cleared++;
    }
  }
  return { cleared };
}

export async function historyFindCached(
  req: HistoryFindCachedRequest,
): Promise<HistoryFindCachedResult> {
  const key = makeCacheKey(req.question, req.collection);
  const db = await getDb();
  const rows = await db.getAllFromIndex('history', 'by-cacheKey', IDBKeyRange.only(key));
  if (rows.length === 0) return { entry: null };
  // Tie-break on newest first so the UI surfaces the most recent plan.
  rows.sort((a, b) => b.createdAt - a.createdAt);
  const entry = HistoryEntry.parse(rows[0].payload);
  if (isSqlHistoryEntry(entry)) return { entry: null };
  if (!entry.outcome.ok) return { entry: null };
  return { entry };
}
