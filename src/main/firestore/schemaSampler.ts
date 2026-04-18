import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore';
import type { CollectionSchema, InferredType, SchemaField } from '@shared/types/schema';

export interface SampleArgs {
  firestore: Firestore;
  collection: string;
  collectionGroup?: boolean;
  sampleSize?: number;
}

const MAX_EXAMPLES = 3;

function inferType(value: unknown): InferredType {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Timestamp) return 'timestamp';
  if (value instanceof GeoPoint) return 'geopoint';
  if (value instanceof DocumentReference) return 'reference';
  if (Array.isArray(value)) return 'array';
  if (value && typeof value === 'object' && 'toBase64' in (value as object)) return 'bytes';
  if (value && typeof value === 'object') return 'map';
  return 'unknown';
}

function summarizeForExample(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof GeoPoint) return { lat: value.latitude, lng: value.longitude };
  if (value instanceof DocumentReference) return value.path;
  if (Array.isArray(value)) {
    return value.slice(0, 3).map(summarizeForExample);
  }
  if (value && typeof value === 'object' && !(value instanceof Timestamp)) {
    const obj: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count >= 5) {
        obj['…'] = 'truncated';
        break;
      }
      obj[k] = summarizeForExample(v);
      count += 1;
    }
    return obj;
  }
  return value;
}

function mergeField(
  fields: Map<string, SchemaField>,
  key: string,
  value: unknown,
): void {
  const type = inferType(value);
  const existing = fields.get(key);
  if (!existing) {
    fields.set(key, {
      name: key,
      types: [type],
      occurrences: 1,
      examples:
        value === undefined || value === null ? [] : [summarizeForExample(value)],
    });
    return;
  }
  existing.occurrences += 1;
  if (!existing.types.includes(type)) existing.types.push(type);
  if (existing.examples.length < MAX_EXAMPLES && value !== undefined && value !== null) {
    existing.examples.push(summarizeForExample(value));
  }
}

export async function sampleCollection(args: SampleArgs): Promise<CollectionSchema> {
  const size = Math.max(1, Math.min(args.sampleSize ?? 10, 200));
  const ref = args.collectionGroup
    ? args.firestore.collectionGroup(args.collection)
    : args.firestore.collection(args.collection);
  const snap = await ref.limit(size).get();

  const fields = new Map<string, SchemaField>();
  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    for (const [k, v] of Object.entries(data)) {
      mergeField(fields, k, v);
    }
  }

  const sortedFields = Array.from(fields.values()).sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    return a.name.localeCompare(b.name);
  });

  return {
    collection: args.collection,
    collectionGroup: args.collectionGroup ?? false,
    sampledCount: snap.size,
    sampledAt: Date.now(),
    fields: sortedFields,
  };
}
