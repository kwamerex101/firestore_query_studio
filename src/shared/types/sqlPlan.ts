import { z } from 'zod';

/**
 * Output of the NL→SQL planner. The planner emits exactly one read-only
 * SQL statement plus a short rationale. The `dialect` tag mirrors the
 * active profile's engine so the renderer can syntax-highlight or auto-
 * format accordingly.
 */
export const SqlPlan = z.object({
  mode: z.literal('sql').default('sql'),
  dialect: z.enum(['postgres', 'mysql', 'mssql', 'bigquery']),
  /**
   * A single read-only statement (SELECT / WITH / SHOW / EXPLAIN / DESC).
   * The driver re-validates this via `sqlSafety` before executing, so a
   * model that ignores the safety rules still can't cause damage.
   */
  sql: z.string().min(1),
  /** Short human-readable explanation of what the statement does. */
  rationale: z.string().min(1),
  /**
   * Row cap the planner wants to return. The driver clamps this down to
   * the profile's `defaultLimit` so a runaway plan can't flood the UI.
   */
  limit: z.number().int().positive().max(50_000).default(50),
  /**
   * Optional list of tables the planner referenced, so the UI can surface
   * schema chips alongside the explanation.
   */
  tables: z.array(z.string()).default([]),
});
export type SqlPlan = z.infer<typeof SqlPlan>;

/**
 * Compact, JSON-safe shape of a single SQL table sample. Kept separate
 * from the driver-level `SqlTableSample` so the renderer can import this
 * without dragging the main-process driver types along.
 */
export const SqlTableSampleFieldView = z.object({
  name: z.string(),
  dataType: z.string(),
  isNullable: z.boolean(),
});
export type SqlTableSampleFieldView = z.infer<typeof SqlTableSampleFieldView>;

export const SqlTableSampleView = z.object({
  table: z.string(),
  schema: z.string().nullable(),
  columns: z.array(SqlTableSampleFieldView),
  rows: z.array(z.record(z.unknown())),
  sampledCount: z.number().int().nonnegative(),
  sampledAt: z.number().int().nonnegative(),
});
export type SqlTableSampleView = z.infer<typeof SqlTableSampleView>;
