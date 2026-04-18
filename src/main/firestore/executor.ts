import type {
  Firestore,
  Query,
  CollectionGroup,
  WhereFilterOp,
  DocumentData,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { GeoPoint } from 'firebase-admin/firestore';
import type { QueryPlan, QueryOnlyPlan, ScanPlan, TypedFilterValue } from '@shared/types/plan';
import { isMulti, isQueryOnly, isScan, isTypedValue } from '@shared/types/plan';
import type { CollectionSchema, SchemaField } from '@shared/types/schema';
import type { ResultRow, RunOutcome, RunResult } from '@shared/types/results';
import { parseIndexHint } from './indexLinkParser';

export interface ExecutorDeps {
  firestore: Firestore;
  profileScanCap: number;
  now?: () => number;
  /**
   * Optional callback that returns the cached schema for a given
   * collection. The executor uses this to coerce plain strings to
   * typed Firestore values (e.g. `Timestamp`, `DocumentReference`)
   * as a safety net when the LLM forgets to emit a typed value.
   *
   * If unset, no schema-aware coercion is performed and the plan's
   * values are used as-is.
   */
  getSchema?: (collection: string, collectionGroup: boolean) => Promise<CollectionSchema | null>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function fieldTypes(schema: CollectionSchema | null | undefined, field: string): SchemaField['types'] | null {
  if (!schema) return null;
  const [head] = field.split('.');
  // Match top-level field name; we don't currently infer nested types.
  const match = schema.fields.find((f) => f.name === head);
  return match ? match.types : null;
}

function parseMaybeDate(value: string): Date | null {
  if (!ISO_DATE_RE.test(value)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export interface DecodeContext {
  firestore: Firestore;
  schema: CollectionSchema | null;
  /** Warnings pushed by the decoder when it coerces untyped values. */
  warnings: string[];
}

/**
 * Convert a plan-supplied filter value into the concrete JS/firebase-admin
 * value that `.where()` expects. Handles:
 *   - Tagged objects `{ __type: 'timestamp' | 'reference' | 'geopoint' }`
 *   - Arrays of those (for `in` / `not-in` / `array-contains-any`)
 *   - Schema-aware coercion of plain strings when the field is known to
 *     be a timestamp / reference (and is NOT also a string).
 *   - Plain primitives (passed through).
 */
export function decodeFilterValue(
  value: unknown,
  field: string,
  ctx: DecodeContext,
): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => decodeFilterValue(v, field, ctx));
  }
  if (isTypedValue(value)) {
    return decodeTyped(value, field, ctx);
  }
  if (typeof value === 'string') {
    const types = fieldTypes(ctx.schema, field);
    if (types && types.length === 1) {
      const only = types[0];
      if (only === 'timestamp') {
        const d = parseMaybeDate(value);
        if (d) {
          ctx.warnings.push(
            `Coerced filter on \`${field}\` from string "${value}" to Timestamp (schema says timestamp).`,
          );
          return d;
        }
      }
      if (only === 'reference') {
        ctx.warnings.push(
          `Coerced filter on \`${field}\` from string "${value}" to DocumentReference (schema says reference).`,
        );
        return ctx.firestore.doc(value);
      }
    }
    // Mixed types (e.g. ['timestamp', 'string']) or unknown → leave as-is.
  }
  return value;
}

function decodeTyped(v: TypedFilterValue, field: string, ctx: DecodeContext): unknown {
  switch (v.__type) {
    case 'timestamp': {
      const d = new Date(v.value);
      if (Number.isNaN(d.getTime())) {
        throw new Error(
          `Invalid timestamp value for \`${field}\`: "${v.value}" is not a parseable ISO 8601 string.`,
        );
      }
      return d;
    }
    case 'reference': {
      // firestore.doc accepts slash-separated paths like "users/abc".
      return ctx.firestore.doc(v.path);
    }
    case 'geopoint':
      return new GeoPoint(v.latitude, v.longitude);
  }
}

const QUERY_OPS: WhereFilterOp[] = [
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
];

function buildQueryFromPlan(
  deps: ExecutorDeps,
  base: QueryOnlyPlan | ScanPlan,
  schema: CollectionSchema | null,
  warnings: string[],
): Query {
  let q: Query | CollectionGroup = base.collectionGroup
    ? deps.firestore.collectionGroup(base.collection)
    : deps.firestore.collection(base.collection);

  const ctx: DecodeContext = {
    firestore: deps.firestore,
    schema,
    warnings,
  };

  for (const filter of base.filters) {
    if (!QUERY_OPS.includes(filter.op as WhereFilterOp)) {
      throw new Error(`Unsupported query operator: ${filter.op}`);
    }
    const decoded = decodeFilterValue(filter.value, filter.field, ctx);
    q = (q as Query).where(filter.field, filter.op as WhereFilterOp, decoded);
  }
  for (const o of base.orderBy) {
    q = (q as Query).orderBy(o.field, o.dir);
  }
  return q as Query;
}

function toRow(doc: QueryDocumentSnapshot): ResultRow {
  const data = doc.data() as DocumentData;
  return {
    id: doc.id,
    path: doc.ref.path,
    data: serializeData(data) as Record<string, unknown>,
  };
}

function serializeData(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (Array.isArray(value)) return value.map(serializeData);
  if (value instanceof Date) return value.toISOString();
  const obj = value as { toDate?: () => Date; constructor?: { name?: string } };
  if (typeof obj?.toDate === 'function') {
    try {
      return { __type: 'timestamp', value: obj.toDate().toISOString() };
    } catch {
      // fall through
    }
  }
  const name = obj?.constructor?.name;
  if (name === 'GeoPoint') {
    const g = value as { latitude: number; longitude: number };
    return { __type: 'geopoint', latitude: g.latitude, longitude: g.longitude };
  }
  if (name === 'DocumentReference') {
    const r = value as { path: string };
    return { __type: 'reference', path: r.path };
  }
  if (t === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeData(v);
    }
    return out;
  }
  return String(value);
}

function matchesPostFilter(row: ResultRow, filter: ScanPlan['postFilters'][number]): boolean {
  const raw = row.data[filter.field];
  const v = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  switch (filter.op) {
    case 'contains':
      return v.includes(filter.value);
    case 'icontains':
      return v.toLowerCase().includes(filter.value.toLowerCase());
    case 'startsWith':
      return v.startsWith(filter.value);
    case 'endsWith':
      return v.endsWith(filter.value);
    case 'eq':
      return v === filter.value;
    case 'neq':
      return v !== filter.value;
    case 'regex':
      try {
        return new RegExp(filter.value).test(v);
      } catch {
        return false;
      }
  }
}

async function runQueryOnly(
  deps: ExecutorDeps,
  plan: QueryOnlyPlan,
  schema: CollectionSchema | null,
): Promise<{ rows: ResultRow[]; scanned: number; matched: number; warnings: string[] }> {
  const warnings: string[] = [];
  const q = buildQueryFromPlan(deps, plan, schema, warnings).limit(plan.limit);
  const snap = await q.get();
  const rows = snap.docs.map(toRow);
  return { rows, scanned: rows.length, matched: rows.length, warnings };
}

async function runScan(
  deps: ExecutorDeps,
  plan: ScanPlan,
  schema: CollectionSchema | null,
): Promise<{ rows: ResultRow[]; scanned: number; matched: number; warnings: string[] }> {
  const warnings: string[] = [];
  const effectiveCap = Math.min(plan.scanCap, deps.profileScanCap);
  if (effectiveCap < plan.scanCap) {
    warnings.push(
      `Scan cap reduced from plan.scanCap=${plan.scanCap} to profile cap=${deps.profileScanCap}.`,
    );
  }
  const q = buildQueryFromPlan(deps, plan, schema, warnings).limit(effectiveCap);
  const snap = await q.get();
  const truncated = snap.size >= effectiveCap;
  if (truncated) {
    warnings.push(
      `Scan hit the cap of ${effectiveCap} documents; results may be incomplete.`,
    );
  }
  const allRows = snap.docs.map(toRow);
  const filtered = allRows.filter((row) =>
    plan.postFilters.every((f) => matchesPostFilter(row, f)),
  );
  const limited = filtered.slice(0, plan.limit);
  return {
    rows: limited,
    scanned: allRows.length,
    matched: filtered.length,
    warnings,
  };
}

async function resolveSchema(
  deps: ExecutorDeps,
  plan: QueryOnlyPlan | ScanPlan,
): Promise<CollectionSchema | null> {
  if (!deps.getSchema) return null;
  try {
    return await deps.getSchema(plan.collection, plan.collectionGroup);
  } catch {
    return null;
  }
}

export async function runPlan(deps: ExecutorDeps, plan: QueryPlan): Promise<RunOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  try {
    if (isQueryOnly(plan)) {
      const schema = await resolveSchema(deps, plan);
      const { rows, scanned, matched, warnings } = await runQueryOnly(deps, plan, schema);
      const duration = now() - started;
      return {
        ok: true,
        rows,
        stats: {
          mode: 'query',
          durationMs: duration,
          scanned,
          matched,
          returned: rows.length,
          truncated: rows.length >= plan.limit,
        },
        warnings,
      } satisfies RunResult;
    }

    if (isScan(plan)) {
      const schema = await resolveSchema(deps, plan);
      const { rows, scanned, matched, warnings } = await runScan(deps, plan, schema);
      const duration = now() - started;
      return {
        ok: true,
        rows,
        stats: {
          mode: 'scan',
          durationMs: duration,
          scanned,
          matched,
          returned: rows.length,
          truncated: scanned >= Math.min(plan.scanCap, deps.profileScanCap),
        },
        warnings,
      } satisfies RunResult;
    }

    if (isMulti(plan)) {
      const rowMap = new Map<string, ResultRow>();
      let totalScanned = 0;
      let totalMatched = 0;
      const warnings: string[] = [];
      const stepStats: NonNullable<RunResult['stats']['stepStats']> = [];

      for (const step of plan.steps) {
        const stepStart = now();
        const schema = await resolveSchema(deps, step);
        if (isQueryOnly(step)) {
          const { rows, scanned, matched, warnings: w } = await runQueryOnly(deps, step, schema);
          rows.forEach((r) => rowMap.set(r.path, r));
          totalScanned += scanned;
          totalMatched += matched;
          warnings.push(...w);
          stepStats.push({
            mode: 'query',
            scanned,
            matched,
            durationMs: now() - stepStart,
          });
        } else {
          const { rows, scanned, matched, warnings: w } = await runScan(deps, step, schema);
          rows.forEach((r) => rowMap.set(r.path, r));
          totalScanned += scanned;
          totalMatched += matched;
          warnings.push(...w);
          stepStats.push({
            mode: 'scan',
            scanned,
            matched,
            durationMs: now() - stepStart,
          });
        }
      }

      const rows = Array.from(rowMap.values());
      const duration = now() - started;
      return {
        ok: true,
        rows,
        stats: {
          mode: 'multi',
          durationMs: duration,
          scanned: totalScanned,
          matched: totalMatched,
          returned: rows.length,
          truncated: false,
          stepStats,
        },
        warnings,
      } satisfies RunResult;
    }

    throw new Error(`Unsupported plan mode: ${(plan as { mode: string }).mode}`);
  } catch (err) {
    const parsed = parseIndexHint(err);
    return {
      ok: false,
      code: parsed.isIndexError ? 'MISSING_INDEX' : 'EXECUTION_ERROR',
      message: err instanceof Error ? err.message : String(err),
      indexHint: parsed.hint,
      warnings: [],
    };
  }
}
