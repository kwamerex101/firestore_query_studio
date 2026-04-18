import { describe, expect, it, vi } from 'vitest';
import { Timestamp, GeoPoint } from 'firebase-admin/firestore';
import { sampleCollection } from '@main/firestore/schemaSampler';

type MockSnap = {
  size: number;
  docs: Array<{ data: () => Record<string, unknown> }>;
};

function mockFirestore(docs: Array<Record<string, unknown>>) {
  const snap: MockSnap = {
    size: docs.length,
    docs: docs.map((d) => ({ data: () => d })),
  };
  const limit = vi.fn(() => ({
    get: vi.fn().mockResolvedValue(snap),
  }));
  const collection = vi.fn(() => ({ limit }));
  const collectionGroup = vi.fn(() => ({ limit }));
  return {
    firestore: { collection, collectionGroup } as unknown as Parameters<typeof sampleCollection>[0]['firestore'],
    collection,
    collectionGroup,
    limit,
  };
}

describe('sampleCollection', () => {
  it('infers field types and aggregates occurrences', async () => {
    const { firestore, collection, limit } = mockFirestore([
      { email: 'a@b.com', age: 30, active: true },
      { email: 'c@d.com', age: 42, active: false, tags: ['x', 'y'] },
      { email: 'e@f.com', createdAt: Timestamp.fromDate(new Date('2024-01-01')) },
    ]);
    const schema = await sampleCollection({ firestore, collection: 'users', sampleSize: 10 });
    expect(collection).toHaveBeenCalledWith('users');
    expect(limit).toHaveBeenCalledWith(10);
    expect(schema.sampledCount).toBe(3);
    expect(schema.collection).toBe('users');
    const fieldNames = schema.fields.map((f) => f.name);
    expect(fieldNames).toContain('email');
    expect(fieldNames).toContain('age');
    expect(fieldNames).toContain('active');
    expect(fieldNames).toContain('tags');
    expect(fieldNames).toContain('createdAt');
    const email = schema.fields.find((f) => f.name === 'email');
    expect(email?.occurrences).toBe(3);
    expect(email?.types).toContain('string');
    const tags = schema.fields.find((f) => f.name === 'tags');
    expect(tags?.types).toContain('array');
    const createdAt = schema.fields.find((f) => f.name === 'createdAt');
    expect(createdAt?.types).toContain('timestamp');
  });

  it('supports collection group queries', async () => {
    const { firestore, collectionGroup } = mockFirestore([{ x: 1 }]);
    await sampleCollection({
      firestore,
      collection: 'orders',
      collectionGroup: true,
      sampleSize: 5,
    });
    expect(collectionGroup).toHaveBeenCalledWith('orders');
  });

  it('handles GeoPoint values as geopoint type', async () => {
    const { firestore } = mockFirestore([{ loc: new GeoPoint(1, 2) }]);
    const schema = await sampleCollection({ firestore, collection: 'places' });
    const loc = schema.fields.find((f) => f.name === 'loc');
    expect(loc?.types).toContain('geopoint');
  });
});
