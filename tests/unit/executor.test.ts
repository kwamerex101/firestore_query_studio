import { describe, expect, it, vi } from 'vitest';
import { GeoPoint } from 'firebase-admin/firestore';
import { runPlan } from '@main/firestore/executor';
import type { QueryPlan } from '@shared/types/plan';
import type { CollectionSchema } from '@shared/types/schema';

function mockFirestoreWithDocs(docs: Array<{ id: string; path: string; data: Record<string, unknown> }>) {
  const snap = {
    size: docs.length,
    docs: docs.map((d) => ({
      id: d.id,
      ref: { path: d.path },
      data: () => d.data,
    })),
  };
  const query: Record<string, unknown> = {};
  query.where = vi.fn().mockReturnValue(query);
  query.orderBy = vi.fn().mockReturnValue(query);
  query.limit = vi.fn().mockReturnValue(query);
  query.get = vi.fn().mockResolvedValue(snap);
  const fakeDocRef = (path: string) => ({ __mockDocRef: true, path });
  const firestore = {
    collection: vi.fn().mockReturnValue(query),
    collectionGroup: vi.fn().mockReturnValue(query),
    doc: vi.fn().mockImplementation(fakeDocRef),
  };
  return { firestore, query };
}

function schemaOf(collection: string, fields: CollectionSchema['fields']): CollectionSchema {
  return {
    collection,
    collectionGroup: false,
    sampledCount: fields.length,
    sampledAt: 0,
    fields,
  };
}

describe('runPlan', () => {
  it('executes a simple query-mode plan and returns rows', async () => {
    const { firestore } = mockFirestoreWithDocs([
      { id: 'u1', path: 'users/u1', data: { email: 'alice@example.com' } },
    ]);
    const plan: QueryPlan = {
      mode: 'query',
      collection: 'users',
      collectionGroup: false,
      filters: [{ field: 'email', op: '==', value: 'alice@example.com' }],
      orderBy: [],
      limit: 50,
      rationale: 'x',
    };
    const out = await runPlan(
      { firestore: firestore as never, profileScanCap: 500 },
      plan,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.rows).toHaveLength(1);
      expect(out.rows[0].data.email).toBe('alice@example.com');
      expect(out.stats.mode).toBe('query');
    }
  });

  it('applies postFilters in scan mode (icontains)', async () => {
    const { firestore } = mockFirestoreWithDocs([
      { id: '1', path: 'users/1', data: { email: 'Alice@Example.com' } },
      { id: '2', path: 'users/2', data: { email: 'bob@example.com' } },
      { id: '3', path: 'users/3', data: { email: 'carol@example.com' } },
    ]);
    const plan: QueryPlan = {
      mode: 'scan',
      collection: 'users',
      collectionGroup: false,
      filters: [],
      orderBy: [],
      limit: 50,
      scanCap: 500,
      postFilters: [{ field: 'email', op: 'icontains', value: 'alice' }],
      rationale: 'x',
    };
    const out = await runPlan(
      { firestore: firestore as never, profileScanCap: 500 },
      plan,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.rows).toHaveLength(1);
      expect(out.stats.mode).toBe('scan');
      expect(out.stats.matched).toBe(1);
      expect(out.stats.scanned).toBe(3);
    }
  });

  it('caps scan using profile scanCap and warns', async () => {
    const docs = Array.from({ length: 10 }, (_, i) => ({
      id: `u${i}`,
      path: `users/u${i}`,
      data: { email: `u${i}@example.com` },
    }));
    const { firestore } = mockFirestoreWithDocs(docs);
    const plan: QueryPlan = {
      mode: 'scan',
      collection: 'users',
      collectionGroup: false,
      filters: [],
      orderBy: [],
      limit: 50,
      scanCap: 5000,
      postFilters: [],
      rationale: 'x',
    };
    const out = await runPlan(
      { firestore: firestore as never, profileScanCap: 100 },
      plan,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.warnings.some((w) => w.includes('reduced'))).toBe(true);
    }
  });

  it('returns MISSING_INDEX when Firestore reports FAILED_PRECONDITION', async () => {
    const query: Record<string, unknown> = {};
    query.where = vi.fn().mockReturnValue(query);
    query.orderBy = vi.fn().mockReturnValue(query);
    query.limit = vi.fn().mockReturnValue(query);
    query.get = vi.fn().mockRejectedValue(
      Object.assign(
        new Error(
          'FAILED_PRECONDITION: requires an index: https://console.firebase.google.com/project/p/firestore/indexes?create_composite=abc',
        ),
        { code: 'FAILED_PRECONDITION' },
      ),
    );
    const firestore = { collection: vi.fn().mockReturnValue(query) };
    const plan: QueryPlan = {
      mode: 'query',
      collection: 'users',
      collectionGroup: false,
      filters: [{ field: 'a', op: '==', value: 1 }],
      orderBy: [{ field: 'b', dir: 'asc' }],
      limit: 50,
      rationale: 'x',
    };
    const out = await runPlan(
      { firestore: firestore as never, profileScanCap: 500 },
      plan,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('MISSING_INDEX');
      expect(out.indexHint?.url).toContain('create_composite=abc');
    }
  });

  it('decodes a tagged timestamp filter value to a Date when calling .where()', async () => {
    const { firestore, query } = mockFirestoreWithDocs([]);
    const plan: QueryPlan = {
      mode: 'query',
      collection: 'profiles',
      collectionGroup: false,
      filters: [
        {
          field: 'createdAt',
          op: '>=',
          value: { __type: 'timestamp', value: '2026-01-01T00:00:00.000Z' },
        },
      ],
      orderBy: [{ field: 'createdAt', dir: 'asc' }],
      limit: 50,
      rationale: 'x',
    };
    await runPlan({ firestore: firestore as never, profileScanCap: 500 }, plan);
    expect(query.where).toHaveBeenCalledTimes(1);
    const [field, op, value] = (query.where as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(field).toBe('createdAt');
    expect(op).toBe('>=');
    expect(value).toBeInstanceOf(Date);
    expect((value as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('decodes a tagged reference value via firestore.doc(path)', async () => {
    const { firestore, query } = mockFirestoreWithDocs([]);
    const plan: QueryPlan = {
      mode: 'query',
      collection: 'subscriptions',
      collectionGroup: false,
      filters: [
        {
          field: 'ownerRef',
          op: '==',
          value: { __type: 'reference', path: 'users/abc123' },
        },
      ],
      orderBy: [],
      limit: 50,
      rationale: 'x',
    };
    await runPlan({ firestore: firestore as never, profileScanCap: 500 }, plan);
    expect(firestore.doc).toHaveBeenCalledWith('users/abc123');
    const [, , value] = (query.where as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(value).toMatchObject({ __mockDocRef: true, path: 'users/abc123' });
  });

  it('decodes a tagged geopoint value to a GeoPoint instance', async () => {
    const { firestore, query } = mockFirestoreWithDocs([]);
    const plan: QueryPlan = {
      mode: 'query',
      collection: 'places',
      collectionGroup: false,
      filters: [
        {
          field: 'location',
          op: '==',
          value: { __type: 'geopoint', latitude: 37.7, longitude: -122.4 },
        },
      ],
      orderBy: [],
      limit: 50,
      rationale: 'x',
    };
    await runPlan({ firestore: firestore as never, profileScanCap: 500 }, plan);
    const [, , value] = (query.where as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(value).toBeInstanceOf(GeoPoint);
    expect((value as GeoPoint).latitude).toBeCloseTo(37.7);
    expect((value as GeoPoint).longitude).toBeCloseTo(-122.4);
  });

  it('coerces plain ISO-string values to Date when schema says field is only a timestamp', async () => {
    const { firestore, query } = mockFirestoreWithDocs([]);
    const schema = schemaOf('profiles', [
      {
        name: 'createdAt',
        types: ['timestamp'],
        occurrences: 10,
        examples: ['2025-11-25T03:27:00.000Z'],
      },
    ]);
    const plan: QueryPlan = {
      mode: 'query',
      collection: 'profiles',
      collectionGroup: false,
      filters: [{ field: 'createdAt', op: '>=', value: '2026-01-01T00:00:00.000Z' }],
      orderBy: [{ field: 'createdAt', dir: 'asc' }],
      limit: 50,
      rationale: 'x',
    };
    const out = await runPlan(
      {
        firestore: firestore as never,
        profileScanCap: 500,
        getSchema: async () => schema,
      },
      plan,
    );
    expect(out.ok).toBe(true);
    const [, , value] = (query.where as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(value).toBeInstanceOf(Date);
    if (out.ok) {
      expect(out.warnings.some((w) => w.includes('Coerced'))).toBe(true);
    }
  });

  it('does NOT coerce when schema lists multiple types (ambiguous)', async () => {
    const { firestore, query } = mockFirestoreWithDocs([]);
    const schema = schemaOf('profiles', [
      {
        name: 'createdAt',
        types: ['timestamp', 'string'],
        occurrences: 10,
        examples: [],
      },
    ]);
    const plan: QueryPlan = {
      mode: 'query',
      collection: 'profiles',
      collectionGroup: false,
      filters: [{ field: 'createdAt', op: '>=', value: '2026-01-01T00:00:00.000Z' }],
      orderBy: [{ field: 'createdAt', dir: 'asc' }],
      limit: 50,
      rationale: 'x',
    };
    await runPlan(
      {
        firestore: firestore as never,
        profileScanCap: 500,
        getSchema: async () => schema,
      },
      plan,
    );
    const [, , value] = (query.where as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof value).toBe('string');
  });

  it('returns an EXECUTION_ERROR when a tagged timestamp is unparseable', async () => {
    const { firestore } = mockFirestoreWithDocs([]);
    const plan: QueryPlan = {
      mode: 'query',
      collection: 'x',
      collectionGroup: false,
      filters: [
        { field: 'createdAt', op: '>=', value: { __type: 'timestamp', value: 'not-a-date' } },
      ],
      orderBy: [{ field: 'createdAt', dir: 'asc' }],
      limit: 50,
      rationale: 'x',
    };
    const out = await runPlan(
      { firestore: firestore as never, profileScanCap: 500 },
      plan,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('EXECUTION_ERROR');
      expect(out.message).toMatch(/timestamp|Invalid/i);
    }
  });

  it('multi-mode dedupes by document path', async () => {
    const snapA = {
      size: 2,
      docs: [
        { id: 'u1', ref: { path: 'users/u1' }, data: () => ({ a: 1 }) },
        { id: 'u2', ref: { path: 'users/u2' }, data: () => ({ a: 2 }) },
      ],
    };
    const snapB = {
      size: 2,
      docs: [
        { id: 'u2', ref: { path: 'users/u2' }, data: () => ({ a: 2 }) },
        { id: 'u3', ref: { path: 'users/u3' }, data: () => ({ a: 3 }) },
      ],
    };
    const results = [snapA, snapB];
    let call = 0;
    const query: Record<string, unknown> = {};
    query.where = vi.fn().mockReturnValue(query);
    query.orderBy = vi.fn().mockReturnValue(query);
    query.limit = vi.fn().mockReturnValue(query);
    query.get = vi.fn().mockImplementation(() => Promise.resolve(results[call++]));
    const firestore = { collection: vi.fn().mockReturnValue(query) };
    const plan: QueryPlan = {
      mode: 'multi',
      rationale: 'OR across fields',
      steps: [
        {
          mode: 'query',
          collection: 'users',
          collectionGroup: false,
          filters: [{ field: 'email', op: '==', value: 'a' }],
          orderBy: [],
          limit: 50,
          rationale: 'step 1',
        },
        {
          mode: 'query',
          collection: 'users',
          collectionGroup: false,
          filters: [{ field: 'phone', op: '==', value: 'b' }],
          orderBy: [],
          limit: 50,
          rationale: 'step 2',
        },
      ],
    };
    const out = await runPlan(
      { firestore: firestore as never, profileScanCap: 500 },
      plan,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.rows).toHaveLength(3);
      expect(out.stats.mode).toBe('multi');
      expect(out.stats.stepStats).toHaveLength(2);
    }
  });
});
