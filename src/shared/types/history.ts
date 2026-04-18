import { z } from 'zod';
import { QueryPlan } from './plan';
import { RunOutcome } from './results';

/**
 * Persisted query history. One entry per completed "Ask" invocation
 * (build+run) or standalone re-run. Stored per profile in userData.
 */
export const HistoryEntry = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  question: z.string().min(1),
  collection: z.string().optional(),
  plan: QueryPlan,
  outcome: RunOutcome,
  /**
   * If the underlying run returned more rows than we chose to persist, we
   * store a capped slice and set this flag. The "Load into Query" flow can
   * still restore the plan and re-run to fetch fresh rows.
   */
  rowsTruncated: z.boolean().default(false),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

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
  mode: z.enum(['query', 'scan', 'multi']),
  ok: z.boolean(),
  rowsReturned: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type HistorySummary = z.infer<typeof HistorySummary>;
