import { z } from 'zod';

/**
 * The single contract between the LLM and the Firestore executor.
 *
 * Only the executor translates this into Firestore SDK calls. The LLM never
 * emits raw code. Phase 1 is read-only: no write ops exist here.
 */

export const FilterOp = z.enum([
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'not-in',
  'array-contains',
  'array-contains-any',
]);
export type FilterOp = z.infer<typeof FilterOp>;

const PrimitiveValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/**
 * Tagged value objects. The LLM MUST emit these when a filter compares
 * against a Firestore-native type that is not a primitive — otherwise the
 * query silently matches zero documents (e.g. string "2026-01-01" is NOT
 * equal to a `Timestamp` of the same instant).
 *
 * The executor translates these back into firebase-admin objects:
 *   - timestamp → Date (firebase-admin serializes Date to Timestamp)
 *   - reference → firestore.doc(path)
 *   - geopoint  → new GeoPoint(lat, lng)
 */
export const TypedTimestampValue = z.object({
  __type: z.literal('timestamp'),
  value: z.string().min(1),
});
export type TypedTimestampValue = z.infer<typeof TypedTimestampValue>;

export const TypedReferenceValue = z.object({
  __type: z.literal('reference'),
  path: z.string().min(1),
});
export type TypedReferenceValue = z.infer<typeof TypedReferenceValue>;

export const TypedGeopointValue = z.object({
  __type: z.literal('geopoint'),
  latitude: z.number(),
  longitude: z.number(),
});
export type TypedGeopointValue = z.infer<typeof TypedGeopointValue>;

export const TypedFilterValue = z.discriminatedUnion('__type', [
  TypedTimestampValue,
  TypedReferenceValue,
  TypedGeopointValue,
]);
export type TypedFilterValue = z.infer<typeof TypedFilterValue>;

const ScalarFilterValue = z.union([PrimitiveValue, TypedFilterValue]);

const FilterValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([ScalarFilterValue, z.array(ScalarFilterValue)]),
);

export const PlanFilter = z.object({
  field: z.string().min(1),
  op: FilterOp,
  value: FilterValue,
});
export type PlanFilter = z.infer<typeof PlanFilter>;

export function isTypedValue(v: unknown): v is TypedFilterValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    '__type' in v &&
    (v as { __type: unknown }).__type !== undefined
  );
}

export const PlanOrderBy = z.object({
  field: z.string().min(1),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type PlanOrderBy = z.infer<typeof PlanOrderBy>;

export const PlanMode = z.enum(['query', 'scan', 'multi']);
export type PlanMode = z.infer<typeof PlanMode>;

const BasePlan = z.object({
  collection: z.string().min(1),
  collectionGroup: z.boolean().default(false),
  filters: z.array(PlanFilter).default([]),
  orderBy: z.array(PlanOrderBy).default([]),
  limit: z.number().int().positive().max(1000).default(50),
  rationale: z.string().min(1),
});

export const QueryOnlyPlan = BasePlan.extend({
  mode: z.literal('query'),
});
export type QueryOnlyPlan = z.infer<typeof QueryOnlyPlan>;

export const ScanPlan = BasePlan.extend({
  mode: z.literal('scan'),
  scanCap: z.number().int().positive().max(50_000).default(500),
  postFilters: z
    .array(
      z.object({
        field: z.string().min(1),
        op: z.enum(['contains', 'icontains', 'startsWith', 'endsWith', 'eq', 'neq', 'regex']),
        value: z.string(),
      }),
    )
    .default([]),
});
export type ScanPlan = z.infer<typeof ScanPlan>;

/**
 * A multi-step plan chains two or more simple (query/scan) sub-plans.
 * Steps are executed in order; the executor returns the union of rows
 * (deduped by document path) and surfaces per-step stats.
 *
 * Not defined via z.lazy because MultiPlan does not reference itself;
 * it only references QueryOnlyPlan / ScanPlan which are already defined.
 */
export const MultiPlan = z.object({
  mode: z.literal('multi'),
  rationale: z.string().min(1),
  steps: z.array(z.union([QueryOnlyPlan, ScanPlan])).min(2),
});
export type MultiPlanType = z.infer<typeof MultiPlan>;

export const QueryPlan = z.union([QueryOnlyPlan, ScanPlan, MultiPlan]);
export type QueryPlan = z.infer<typeof QueryPlan>;

export function isQueryOnly(plan: QueryPlan): plan is QueryOnlyPlan {
  return plan.mode === 'query';
}
export function isScan(plan: QueryPlan): plan is ScanPlan {
  return plan.mode === 'scan';
}
export function isMulti(plan: QueryPlan): plan is MultiPlanType {
  return plan.mode === 'multi';
}
