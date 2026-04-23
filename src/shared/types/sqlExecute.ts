import { z } from 'zod';

export const SqlColumn = z.object({
  name: z.string(),
  dataType: z.string().optional(),
});
export type SqlColumn = z.infer<typeof SqlColumn>;

/**
 * `z.any()` is intentional for row values: we already enforce JSON-safe
 * primitives at the driver boundary (`toSqlCell`) and don't want the
 * contextBridge's structured-clone to reject arbitrarily-shaped rows.
 */
export const SqlRow = z.record(z.any());
export type SqlRow = z.infer<typeof SqlRow>;

export const SqlExecuteOk = z.object({
  ok: z.literal(true),
  columns: z.array(SqlColumn),
  rows: z.array(SqlRow),
  elapsedMs: z.number().int().nonnegative(),
  truncated: z.boolean(),
  rowCountHint: z.number().int().nonnegative().optional(),
});
export const SqlExecuteErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  elapsedMs: z.number().int().nonnegative(),
  executedSql: z.string().optional(),
});
export const SqlExecuteOutcome = z.discriminatedUnion('ok', [SqlExecuteOk, SqlExecuteErr]);
export type SqlExecuteOutcome = z.infer<typeof SqlExecuteOutcome>;
