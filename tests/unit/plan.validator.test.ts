import { describe, expect, it } from 'vitest';
import { QueryPlan } from '@shared/types/plan';

describe('QueryPlan Zod validator', () => {
  it('accepts a minimal query-mode plan and applies defaults', () => {
    const parsed = QueryPlan.parse({
      mode: 'query',
      collection: 'users',
      filters: [{ field: 'email', op: '==', value: 'a@b.com' }],
      rationale: 'Equality on email.',
    });
    expect(parsed.mode).toBe('query');
    if (parsed.mode === 'query') {
      expect(parsed.collectionGroup).toBe(false);
      expect(parsed.limit).toBe(50);
      expect(parsed.orderBy).toEqual([]);
    }
  });

  it('rejects unknown filter operator', () => {
    const r = QueryPlan.safeParse({
      mode: 'query',
      collection: 'users',
      filters: [{ field: 'email', op: 'LIKE', value: 'a' }],
      rationale: 'bad',
    });
    expect(r.success).toBe(false);
  });

  it('accepts scan-mode plan with postFilters', () => {
    const parsed = QueryPlan.parse({
      mode: 'scan',
      collection: 'users',
      postFilters: [{ field: 'email', op: 'icontains', value: 'alice' }],
      rationale: 'Substring search.',
    });
    expect(parsed.mode).toBe('scan');
    if (parsed.mode === 'scan') {
      expect(parsed.scanCap).toBe(500);
      expect(parsed.limit).toBe(50);
    }
  });

  it('enforces scanCap upper bound', () => {
    const r = QueryPlan.safeParse({
      mode: 'scan',
      collection: 'users',
      scanCap: 1_000_000,
      postFilters: [],
      rationale: 'too big',
    });
    expect(r.success).toBe(false);
  });

  it('accepts multi-mode plan with two steps', () => {
    const parsed = QueryPlan.parse({
      mode: 'multi',
      rationale: 'OR across fields',
      steps: [
        {
          mode: 'query',
          collection: 'users',
          filters: [{ field: 'email', op: '==', value: 'a@b.com' }],
          rationale: 'Step 1',
        },
        {
          mode: 'query',
          collection: 'users',
          filters: [{ field: 'phone', op: '==', value: '+100' }],
          rationale: 'Step 2',
        },
      ],
    });
    expect(parsed.mode).toBe('multi');
  });

  it('rejects multi-mode with fewer than two steps', () => {
    const r = QueryPlan.safeParse({
      mode: 'multi',
      rationale: 'bad',
      steps: [
        {
          mode: 'query',
          collection: 'users',
          rationale: 'only one',
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects plan without rationale', () => {
    const r = QueryPlan.safeParse({
      mode: 'query',
      collection: 'users',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty collection string', () => {
    const r = QueryPlan.safeParse({
      mode: 'query',
      collection: '',
      rationale: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('enforces limit upper bound', () => {
    const r = QueryPlan.safeParse({
      mode: 'query',
      collection: 'users',
      limit: 2000,
      rationale: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('accepts array values for "in" operator', () => {
    const r = QueryPlan.safeParse({
      mode: 'query',
      collection: 'users',
      filters: [{ field: 'role', op: 'in', value: ['admin', 'owner'] }],
      rationale: 'x',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a tagged timestamp filter value', () => {
    const parsed = QueryPlan.parse({
      mode: 'query',
      collection: 'profiles',
      filters: [
        {
          field: 'createdAt',
          op: '>=',
          value: { __type: 'timestamp', value: '2026-01-01T00:00:00.000Z' },
        },
      ],
      orderBy: [{ field: 'createdAt', dir: 'asc' }],
      rationale: 'Timestamp range',
    });
    expect(parsed.mode).toBe('query');
  });

  it('accepts a tagged reference filter value', () => {
    const r = QueryPlan.safeParse({
      mode: 'query',
      collection: 'subscriptions',
      filters: [
        {
          field: 'ownerRef',
          op: '==',
          value: { __type: 'reference', path: 'users/abc123' },
        },
      ],
      rationale: 'Reference equality',
    });
    expect(r.success).toBe(true);
  });

  it('accepts a tagged geopoint filter value', () => {
    const r = QueryPlan.safeParse({
      mode: 'query',
      collection: 'places',
      filters: [
        {
          field: 'location',
          op: '==',
          value: { __type: 'geopoint', latitude: 37.7, longitude: -122.4 },
        },
      ],
      rationale: 'Geopoint match',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a typed value with unknown __type', () => {
    const r = QueryPlan.safeParse({
      mode: 'query',
      collection: 'x',
      filters: [{ field: 'f', op: '==', value: { __type: 'bogus', value: 'y' } }],
      rationale: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('accepts an array of tagged references for "in"', () => {
    const r = QueryPlan.safeParse({
      mode: 'query',
      collection: 'x',
      filters: [
        {
          field: 'ownerRef',
          op: 'in',
          value: [
            { __type: 'reference', path: 'users/a' },
            { __type: 'reference', path: 'users/b' },
          ],
        },
      ],
      rationale: 'x',
    });
    expect(r.success).toBe(true);
  });
});
