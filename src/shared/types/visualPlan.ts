import { z } from 'zod';

/**
 * Chart spec DSL returned by the LLM and rendered by the chart registry
 * (`src/renderer/components/charts/registry.tsx`). The planner produces
 * a `VisualPlan` — a list of specs and an optional one-sentence
 * narrative — which the renderer validates with Zod before dispatching
 * each spec to its component.
 *
 * Intentionally narrow: only JSON-safe primitives and a fixed set of
 * `type` discriminators. The LLM cannot inject arbitrary component
 * trees — it can only pick from the registered chart types and pass
 * pre-aggregated data.
 */

const DatumValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const NumericFormat = z.enum(['number', 'percent', 'currency', 'duration']);

export const KpiSpec = z.object({
  type: z.literal('kpi'),
  title: z.string().min(1),
  value: z.union([z.number(), z.string()]),
  hint: z.string().optional(),
  format: NumericFormat.optional(),
  delta: z.number().optional(),
});
export type KpiSpec = z.infer<typeof KpiSpec>;

const CartesianDatum = z.record(DatumValue);

export const BarSpec = z.object({
  type: z.literal('bar'),
  title: z.string().min(1),
  xField: z.string().min(1),
  yField: z.string().min(1),
  seriesField: z.string().min(1).optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  orientation: z.enum(['vertical', 'horizontal']).optional(),
  data: z.array(CartesianDatum).min(1),
});
export type BarSpec = z.infer<typeof BarSpec>;

export const LineSpec = z.object({
  type: z.literal('line'),
  title: z.string().min(1),
  xField: z.string().min(1),
  yField: z.string().min(1),
  seriesField: z.string().min(1).optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  data: z.array(CartesianDatum).min(1),
});
export type LineSpec = z.infer<typeof LineSpec>;

export const AreaSpec = z.object({
  type: z.literal('area'),
  title: z.string().min(1),
  xField: z.string().min(1),
  yField: z.string().min(1),
  seriesField: z.string().min(1).optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  data: z.array(CartesianDatum).min(1),
});
export type AreaSpec = z.infer<typeof AreaSpec>;

export const PieSpec = z.object({
  type: z.literal('pie'),
  title: z.string().min(1),
  labelField: z.string().min(1),
  valueField: z.string().min(1),
  data: z
    .array(
      z.object({
        label: z.string().optional(),
        value: z.number().optional(),
      }).catchall(DatumValue),
    )
    .min(1),
});
export type PieSpec = z.infer<typeof PieSpec>;

export const HistogramSpec = z.object({
  type: z.literal('histogram'),
  title: z.string().min(1),
  field: z.string().min(1),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  bins: z
    .array(
      z.object({
        label: z.string().min(1),
        count: z.number().nonnegative(),
      }),
    )
    .min(1),
});
export type HistogramSpec = z.infer<typeof HistogramSpec>;

export const ScatterSpec = z.object({
  type: z.literal('scatter'),
  title: z.string().min(1),
  xField: z.string().min(1),
  yField: z.string().min(1),
  seriesField: z.string().min(1).optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  data: z.array(z.record(DatumValue)).min(1),
});
export type ScatterSpec = z.infer<typeof ScatterSpec>;

export const VisualSpec = z.discriminatedUnion('type', [
  KpiSpec,
  BarSpec,
  LineSpec,
  AreaSpec,
  PieSpec,
  HistogramSpec,
  ScatterSpec,
]);
export type VisualSpec = z.infer<typeof VisualSpec>;

export const VisualPlan = z.object({
  specs: z.array(VisualSpec).default([]),
  narrative: z.string().optional(),
});
export type VisualPlan = z.infer<typeof VisualPlan>;

/**
 * Lenient parse: validate each spec individually so a single malformed
 * chart doesn't discard the whole set. Returns the subset of specs
 * that passed validation plus a count of the ones that didn't.
 */
export function parseVisualPlanLenient(
  raw: unknown,
): { plan: VisualPlan; dropped: number } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { plan: { specs: [] }, dropped: 0 };
  }
  const obj = raw as Record<string, unknown>;
  const rawSpecs = Array.isArray(obj.specs) ? obj.specs : [];
  const narrative =
    typeof obj.narrative === 'string' && obj.narrative.trim().length > 0
      ? obj.narrative.trim()
      : undefined;
  const specs: VisualSpec[] = [];
  let dropped = 0;
  for (const item of rawSpecs) {
    const parsed = VisualSpec.safeParse(item);
    if (parsed.success) {
      specs.push(parsed.data);
    } else {
      dropped += 1;
    }
  }
  return { plan: { specs, narrative }, dropped };
}
