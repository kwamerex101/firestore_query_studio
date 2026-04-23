import {
  collection as fsCollection,
  collectionGroup as fsCollectionGroup,
  doc as fsDoc,
  getDocs,
  limit as fsLimit,
  orderBy as fsOrderBy,
  query as fsQuery,
  Timestamp,
  GeoPoint,
  where as fsWhere,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type WhereFilterOp,
} from 'firebase/firestore';
import { isTypedValue, type PlanFilter, type QueryPlan } from '@shared/types/plan';
import type { RunOutcome, ResultRow } from '@shared/types/results';
import {
  getFirestoreForActive,
  WebProfileNotConfiguredError,
} from './firebase';

/**
 * Browser-side QueryPlan executor. Mirrors the semantics of
 * `src/main/firestore/executor.ts` (desktop / Admin SDK) but uses the
 * Firebase Web SDK so requests go through Firestore's REST/WebChannel
 * transport, gated by the user's Security Rules + Firebase Auth session.
 *
 * Caveats vs desktop:
 *   - We can't bypass Security Rules, so anything the rules forbid returns
 *     a `PERMISSION_DENIED` rather than silent zero-row results.
 *   - Cross-collection `multi` plans work only if rules allow the user to
 *     read each referenced collection.
 *   - There is no Admin-side retry/backoff; relying on the SDK's default.
 */

const WEB_SDK_OPS: Record<string, WhereFilterOp> = {
  '==': '==',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  in: 'in',
  'not-in': 'not-in',
  'array-contains': 'array-contains',
  'array-contains-any': 'array-contains-any',
};

function resolveTypedValue(
  firestore: Firestore,
  v: unknown,
): unknown {
  if (isTypedValue(v)) {
    switch (v.__type) {
      case 'timestamp':
        return Timestamp.fromDate(new Date(v.value));
      case 'reference':
        // `v.path` is like "users/abc123"; web SDK needs segments.
        return fsDoc(firestore, v.path);
      case 'geopoint':
        return new GeoPoint(v.latitude, v.longitude);
    }
  }
  if (Array.isArray(v)) return v.map((item) => resolveTypedValue(firestore, item));
  return v;
}

function applyFilter(
  firestore: Firestore,
  q: Query,
  f: PlanFilter,
): Query {
  const op = WEB_SDK_OPS[f.op];
  if (!op) {
    throw new Error(`Unsupported filter operator on web: ${f.op}`);
  }
  return fsQuery(q, fsWhere(f.field, op, resolveTypedValue(firestore, f.value)));
}

function buildBaseQuery(
  firestore: Firestore,
  spec: { collection: string; collectionGroup: boolean },
): Query {
  return spec.collectionGroup
    ? fsCollectionGroup(firestore, spec.collection)
    : fsCollection(firestore, spec.collection);
}

function snapshotToRow(snap: QueryDocumentSnapshot): ResultRow {
  const data = snap.data();
  // `data` preserves Timestamp / GeoPoint / DocumentReference instances. For
  // the result table we flatten them to JSON-friendly primitives so downstream
  // consumers (history persistence, LLM insights) don't have to worry about
  // SDK-specific types. This mirrors what the desktop executor does.
  return {
    id: snap.id,
    path: snap.ref.path,
    data: flattenValue(data) as Record<string, unknown>,
  };
}

function flattenValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof GeoPoint) {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  // `DocumentReference` has a `.path` on both client and admin SDKs.
  if (
    typeof value === 'object' &&
    'path' in (value as { path?: unknown }) &&
    typeof (value as { path: unknown }).path === 'string' &&
    'id' in (value as { id?: unknown })
  ) {
    return (value as { path: string }).path;
  }
  if (Array.isArray(value)) return value.map(flattenValue);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = flattenValue(v);
    }
    return out;
  }
  return value;
}

interface RunPart {
  scanned: number;
  matched: number;
  rows: ResultRow[];
  durationMs: number;
}

async function runQueryOnly(
  firestore: Firestore,
  plan: Extract<QueryPlan, { mode: 'query' }>,
): Promise<RunPart> {
  const started = performance.now();
  let q = buildBaseQuery(firestore, {
    collection: plan.collection,
    collectionGroup: plan.collectionGroup,
  });
  for (const f of plan.filters) q = applyFilter(firestore, q, f);
  for (const o of plan.orderBy) q = fsQuery(q, fsOrderBy(o.field, o.dir));
  q = fsQuery(q, fsLimit(plan.limit));

  const snapshot = await getDocs(q);
  const rows = snapshot.docs.map(snapshotToRow);
  return {
    scanned: snapshot.size,
    matched: snapshot.size,
    rows,
    durationMs: performance.now() - started,
  };
}

function matchesPostFilter(
  row: ResultRow,
  pf: Extract<QueryPlan, { mode: 'scan' }>['postFilters'][number],
): boolean {
  const raw = row.data[pf.field];
  const actual = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
  switch (pf.op) {
    case 'contains':
      return actual.includes(pf.value);
    case 'icontains':
      return actual.toLowerCase().includes(pf.value.toLowerCase());
    case 'startsWith':
      return actual.startsWith(pf.value);
    case 'endsWith':
      return actual.endsWith(pf.value);
    case 'eq':
      return actual === pf.value;
    case 'neq':
      return actual !== pf.value;
    case 'regex':
      try {
        return new RegExp(pf.value).test(actual);
      } catch {
        return false;
      }
  }
}

async function runScan(
  firestore: Firestore,
  plan: Extract<QueryPlan, { mode: 'scan' }>,
): Promise<RunPart> {
  const started = performance.now();
  let q = buildBaseQuery(firestore, {
    collection: plan.collection,
    collectionGroup: plan.collectionGroup,
  });
  for (const f of plan.filters) q = applyFilter(firestore, q, f);
  for (const o of plan.orderBy) q = fsQuery(q, fsOrderBy(o.field, o.dir));
  const cap = Math.min(plan.scanCap, 50_000);
  q = fsQuery(q, fsLimit(cap));

  const snapshot = await getDocs(q);
  const allRows = snapshot.docs.map(snapshotToRow);
  const matched = plan.postFilters.length
    ? allRows.filter((row) =>
        plan.postFilters.every((pf) => matchesPostFilter(row, pf)),
      )
    : allRows;
  const returned = matched.slice(0, plan.limit);
  return {
    scanned: allRows.length,
    matched: matched.length,
    rows: returned,
    durationMs: performance.now() - started,
  };
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code: unknown }).code;
    if (typeof c === 'string') return c.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  }
  return 'UNEXPECTED';
}

function indexHintFor(err: unknown): { url?: string } | undefined {
  if (!(err instanceof Error)) return undefined;
  const m = err.message.match(/https:\/\/console\.firebase\.google\.com[^\s)]+/);
  return m ? { url: m[0] } : undefined;
}

export async function runPlan(plan: QueryPlan): Promise<RunOutcome> {
  let firestore: Firestore;
  try {
    firestore = (await getFirestoreForActive()).firestore;
  } catch (err) {
    if (err instanceof WebProfileNotConfiguredError) {
      return {
        ok: false,
        code: err.code,
        message: err.message,
        warnings: [],
      };
    }
    return {
      ok: false,
      code: 'UNEXPECTED',
      message: err instanceof Error ? err.message : String(err),
      warnings: [],
    };
  }

  try {
    if (plan.mode === 'query') {
      const part = await runQueryOnly(firestore, plan);
      return {
        ok: true,
        rows: part.rows,
        stats: {
          mode: 'query',
          durationMs: part.durationMs,
          scanned: part.scanned,
          matched: part.matched,
          returned: part.rows.length,
          truncated: part.rows.length >= plan.limit,
        },
        warnings: [],
      };
    }

    if (plan.mode === 'scan') {
      const part = await runScan(firestore, plan);
      const warnings: string[] = [];
      if (part.scanned >= plan.scanCap) {
        warnings.push(
          `Hit scan cap (${plan.scanCap} docs). Tighten filters or raise the cap to widen coverage.`,
        );
      }
      return {
        ok: true,
        rows: part.rows,
        stats: {
          mode: 'scan',
          durationMs: part.durationMs,
          scanned: part.scanned,
          matched: part.matched,
          returned: part.rows.length,
          truncated: part.matched > part.rows.length,
        },
        warnings,
      };
    }

    // Multi: run steps sequentially and union by path.
    const started = performance.now();
    const byPath = new Map<string, ResultRow>();
    const stepStats: NonNullable<
      Extract<RunOutcome, { ok: true }>['stats']['stepStats']
    > = [];
    let totalScanned = 0;
    let totalMatched = 0;
    const warnings: string[] = [];

    for (const step of plan.steps) {
      const part =
        step.mode === 'query'
          ? await runQueryOnly(firestore, step)
          : await runScan(firestore, step);
      totalScanned += part.scanned;
      totalMatched += part.matched;
      stepStats.push({
        mode: step.mode,
        scanned: part.scanned,
        matched: part.matched,
        durationMs: part.durationMs,
      });
      for (const row of part.rows) {
        if (!byPath.has(row.path)) byPath.set(row.path, row);
      }
    }

    return {
      ok: true,
      rows: Array.from(byPath.values()),
      stats: {
        mode: 'multi',
        durationMs: performance.now() - started,
        scanned: totalScanned,
        matched: totalMatched,
        returned: byPath.size,
        truncated: false,
        stepStats,
      },
      warnings,
    };
  } catch (err) {
    const hint = indexHintFor(err);
    return {
      ok: false,
      code: errorCode(err),
      message: err instanceof Error ? err.message : String(err),
      warnings: [],
      ...(hint ? { indexHint: { message: 'Firestore suggested an index.', ...hint } } : {}),
    };
  }
}
