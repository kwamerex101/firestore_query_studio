import { z } from 'zod';

export const ResultRow = z.object({
  id: z.string(),
  path: z.string(),
  data: z.record(z.unknown()),
});
export type ResultRow = z.infer<typeof ResultRow>;

export const RunStats = z.object({
  mode: z.enum(['query', 'scan', 'multi']),
  durationMs: z.number().nonnegative(),
  scanned: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  truncated: z.boolean().default(false),
  stepStats: z
    .array(
      z.object({
        mode: z.enum(['query', 'scan']),
        scanned: z.number().int().nonnegative(),
        matched: z.number().int().nonnegative(),
        durationMs: z.number().nonnegative(),
      }),
    )
    .optional(),
});
export type RunStats = z.infer<typeof RunStats>;

export const IndexHint = z.object({
  message: z.string(),
  url: z.string().url().optional(),
});
export type IndexHint = z.infer<typeof IndexHint>;

export const RunResult = z.object({
  ok: z.literal(true),
  rows: z.array(ResultRow),
  stats: RunStats,
  warnings: z.array(z.string()).default([]),
});
export type RunResult = z.infer<typeof RunResult>;

export const RunError = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  indexHint: IndexHint.optional(),
  warnings: z.array(z.string()).default([]),
});
export type RunError = z.infer<typeof RunError>;

export const RunOutcome = z.discriminatedUnion('ok', [RunResult, RunError]);
export type RunOutcome = z.infer<typeof RunOutcome>;
