import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPlan } from '@main/firestore/executor';
import { sampleCollection } from '@main/firestore/schemaSampler';
import type { QueryPlan } from '@shared/types/plan';
import { clearCollection, connectEmulator, type EmulatorHandle } from './emulator.setup';

describe('executor + emulator', () => {
  let handle: EmulatorHandle;

  beforeAll(async () => {
    handle = connectEmulator();
    await clearCollection(handle.firestore, 'users');

    const batch = handle.firestore.batch();
    const users = [
      { id: 'u1', email: 'alice@example.com', name: 'Alice', active: true, age: 30 },
      { id: 'u2', email: 'bob@example.com', name: 'Bob', active: true, age: 28 },
      { id: 'u3', email: 'carol@acme.co', name: 'Carol', active: false, age: 41 },
      { id: 'u4', email: 'dave@example.com', name: 'Dave', active: true, age: 35 },
      { id: 'u5', email: 'eve@acme.co', name: 'Eve', active: false, age: 22 },
    ];
    for (const u of users) {
      const { id, ...data } = u;
      batch.set(handle.firestore.doc(`users/${id}`), data);
    }
    await batch.commit();
  });

  afterAll(async () => {
    await clearCollection(handle.firestore, 'users');
    await handle.dispose();
  });

  it('runs a query-mode plan against the emulator', async () => {
    const plan: QueryPlan = {
      mode: 'query',
      collection: 'users',
      collectionGroup: false,
      filters: [{ field: 'email', op: '==', value: 'alice@example.com' }],
      orderBy: [],
      limit: 10,
      rationale: 'equality lookup',
    };
    const out = await runPlan({ firestore: handle.firestore, profileScanCap: 500 }, plan);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.rows).toHaveLength(1);
      expect(out.rows[0].id).toBe('u1');
      expect(out.stats.mode).toBe('query');
    }
  });

  it('runs a scan with icontains postFilter', async () => {
    const plan: QueryPlan = {
      mode: 'scan',
      collection: 'users',
      collectionGroup: false,
      filters: [],
      orderBy: [],
      limit: 20,
      scanCap: 100,
      postFilters: [{ field: 'email', op: 'icontains', value: 'acme' }],
      rationale: 'case-insensitive substring search',
    };
    const out = await runPlan({ firestore: handle.firestore, profileScanCap: 500 }, plan);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.rows).toHaveLength(2);
      const ids = out.rows.map((r) => r.id).sort();
      expect(ids).toEqual(['u3', 'u5']);
      expect(out.stats.mode).toBe('scan');
    }
  });

  it('runs a multi-step plan and dedupes by path', async () => {
    const plan: QueryPlan = {
      mode: 'multi',
      rationale: 'OR across fields',
      steps: [
        {
          mode: 'query',
          collection: 'users',
          collectionGroup: false,
          filters: [{ field: 'email', op: '==', value: 'alice@example.com' }],
          orderBy: [],
          limit: 10,
          rationale: 'step 1',
        },
        {
          mode: 'query',
          collection: 'users',
          collectionGroup: false,
          filters: [{ field: 'age', op: '>=', value: 40 }],
          orderBy: [{ field: 'age', dir: 'asc' }],
          limit: 10,
          rationale: 'step 2',
        },
      ],
    };
    const out = await runPlan({ firestore: handle.firestore, profileScanCap: 500 }, plan);
    expect(out.ok).toBe(true);
    if (out.ok) {
      const ids = out.rows.map((r) => r.id).sort();
      expect(ids).toEqual(['u1', 'u3']);
      expect(out.stats.stepStats).toHaveLength(2);
    }
  });

  it('samples the collection schema via the sampler', async () => {
    const schema = await sampleCollection({
      firestore: handle.firestore,
      collection: 'users',
      sampleSize: 5,
    });
    expect(schema.sampledCount).toBe(5);
    const names = schema.fields.map((f) => f.name).sort();
    expect(names).toEqual(['active', 'age', 'email', 'name']);
    const age = schema.fields.find((f) => f.name === 'age');
    expect(age?.types).toContain('number');
    const active = schema.fields.find((f) => f.name === 'active');
    expect(active?.types).toContain('boolean');
  });

  it('caps scan at profile scanCap and emits warning when smaller than plan cap', async () => {
    const plan: QueryPlan = {
      mode: 'scan',
      collection: 'users',
      collectionGroup: false,
      filters: [],
      orderBy: [],
      limit: 10,
      scanCap: 1000,
      postFilters: [],
      rationale: 'scan all',
    };
    const out = await runPlan({ firestore: handle.firestore, profileScanCap: 3 }, plan);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.warnings.some((w) => w.includes('reduced'))).toBe(true);
      expect(out.stats.scanned).toBeLessThanOrEqual(3);
    }
  });
});
