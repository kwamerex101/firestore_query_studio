import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  HistoryEntry,
  HistorySummary,
} from '@shared/types/history';

const MAX_ENTRIES = 500;
const MAX_ROWS_PER_ENTRY = 200;

type CacheFile = {
  version: 1;
  entries: HistoryEntry[];
};

function cachePath(profileId: string): string {
  return join(app.getPath('userData'), `history.${profileId}.json`);
}

async function readFile(profileId: string): Promise<CacheFile> {
  try {
    const raw = await fs.readFile(cachePath(profileId), 'utf8');
    const parsed = JSON.parse(raw) as CacheFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, entries: [] };
    }
    throw err;
  }
}

async function writeFile(profileId: string, data: CacheFile): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(cachePath(profileId), JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
}

function summarize(entry: HistoryEntry): HistorySummary {
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

function truncateOutcomeRows(entry: HistoryEntry): HistoryEntry {
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

export async function listHistory(
  profileId: string,
  limit = 200,
): Promise<HistorySummary[]> {
  const file = await readFile(profileId);
  return file.entries
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(summarize);
}

export async function getHistoryEntry(
  profileId: string,
  id: string,
): Promise<HistoryEntry | null> {
  const file = await readFile(profileId);
  return file.entries.find((e) => e.id === id) ?? null;
}

export async function addHistoryEntry(
  profileId: string,
  input: Omit<HistoryEntry, 'id' | 'profileId' | 'createdAt' | 'rowsTruncated'>,
): Promise<HistoryEntry> {
  const file = await readFile(profileId);
  const entry: HistoryEntry = {
    id: randomUUID(),
    profileId,
    createdAt: Date.now(),
    rowsTruncated: false,
    question: input.question,
    collection: input.collection,
    plan: input.plan,
    outcome: input.outcome,
  };
  const trimmed = truncateOutcomeRows(entry);
  file.entries.push(trimmed);
  // Keep newest-first ordering on disk to simplify debugging; also cap size.
  file.entries.sort((a, b) => b.createdAt - a.createdAt);
  if (file.entries.length > MAX_ENTRIES) {
    file.entries = file.entries.slice(0, MAX_ENTRIES);
  }
  await writeFile(profileId, file);
  return trimmed;
}

export async function clearHistory(profileId: string): Promise<number> {
  const file = await readFile(profileId);
  const count = file.entries.length;
  try {
    await fs.unlink(cachePath(profileId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return count;
}

/**
 * Return the most recent successful entry matching (question, collection).
 * Used to offer "reuse previous answer" without re-hitting the LLM.
 */
export async function findCachedEntry(
  profileId: string,
  question: string,
  collection: string | undefined,
): Promise<HistoryEntry | null> {
  const file = await readFile(profileId);
  const normalizedQ = question.trim();
  const normalizedC = collection?.trim() || undefined;
  const match = file.entries
    .filter(
      (e) =>
        e.question.trim() === normalizedQ &&
        (e.collection?.trim() || undefined) === normalizedC &&
        e.outcome.ok,
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return match ?? null;
}
