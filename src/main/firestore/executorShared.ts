import type {
  Firestore,
  Query,
  CollectionGroup,
  WhereFilterOp,
  DocumentData,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { GeoPoint } from 'firebase-admin/firestore';
import type { QueryOnlyPlan, ScanPlan, TypedFilterValue } from '@shared/types/plan';
import { isTypedValue } from '@shared/types/plan';
import type { CollectionSchema, SchemaField } from '@shared/types/schema';
import type { ResultRow } from '@shared/types/results';

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export interface DecodeContext {
  firestore: Firestore;
  schema: CollectionSchema | null;
  warnings: string[];
}

function fieldTypes(
  schema: CollectionSchema | null | undefined,
  field: string,
): SchemaField['types'] | null {
  if (!schema) return null;
  const [head] = field.split('.');
  const match = schema.fields.find((f) => f.name === head);
  return match ? match.types : null;
}

function parseMaybeDate(value: string): Date | null {
  if (!ISO_DATE_RE.test(value)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

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
  }
  return value;
}

function decodeTyped(
  v: TypedFilterValue,
  field: string,
  ctx: DecodeContext,
): unknown {
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
    case 'reference':
      return ctx.firestore.doc(v.path);
    case 'geopoint':
      return new GeoPoint(v.latitude, v.longitude);
  }
}

export const QUERY_OPS: WhereFilterOp[] = [
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

export function buildQueryFromPlan(
  firestore: Firestore,
  base: QueryOnlyPlan | ScanPlan,
  schema: CollectionSchema | null,
  warnings: string[],
): Query {
  let q: Query | CollectionGroup = base.collectionGroup
    ? firestore.collectionGroup(base.collection)
    : firestore.collection(base.collection);

  const ctx: DecodeContext = { firestore, schema, warnings };

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

export function serializeData(value: unknown): unknown {
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
      /* fall through */
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

export function serializeDoc(doc: unknown): ResultRow {
  const snap = doc as QueryDocumentSnapshot;
  const data = snap.data() as DocumentData;
  return {
    id: snap.id,
    path: snap.ref.path,
    data: serializeData(data) as Record<string, unknown>,
  };
}

export function matchesPostFilter(
  row: ResultRow,
  filter: ScanPlan['postFilters'][number],
): boolean {
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
