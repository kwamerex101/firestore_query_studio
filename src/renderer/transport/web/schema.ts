import {
  collection as fsCollection,
  collectionGroup as fsCollectionGroup,
  DocumentReference,
  GeoPoint,
  getDocs,
  limit as fsLimit,
  query as fsQuery,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import type {
  CollectionSchema,
  InferredType,
  SchemaField,
} from '@shared/types/schema';
import type {
  SchemaGetRequest,
  SchemaSampleRequest,
  SchemaSaveOverrideRequest,
} from '@shared/types/ipc';
import {
  getFirestoreForActive,
  WebProfileNotConfiguredError,
} from './firebase';
import { getActiveProfileId } from './profiles';
import { getDb } from './db';

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
  if (value && typeof value === 'object' && 'toBase64' in (value as object))
    return 'bytes';
  if (value && typeof value === 'object') return 'map';
  return 'unknown';
}

function summarizeForExample(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof GeoPoint)
    return { lat: value.latitude, lng: value.longitude };
  if (value instanceof DocumentReference) return value.path;
  if (Array.isArray(value)) return value.slice(0, 3).map(summarizeForExample);
  if (value && typeof value === 'object') {
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

async function sampleSchema(
  firestore: Firestore,
  req: SchemaSampleRequest,
): Promise<CollectionSchema> {
  const sampleSize = Math.min(Math.max(req.sampleSize ?? 10, 1), 200);
  const base = req.collectionGroup
    ? fsCollectionGroup(firestore, req.collection)
    : fsCollection(firestore, req.collection);
  const snap = await getDocs(fsQuery(base, fsLimit(sampleSize)));

  const fieldMap = new Map<
    string,
    { types: Set<InferredType>; occurrences: number; examples: unknown[] }
  >();

  for (const doc of snap.docs) {
    const data = doc.data();
    for (const [name, value] of Object.entries(data)) {
      const entry = fieldMap.get(name) ?? {
        types: new Set<InferredType>(),
        occurrences: 0,
        examples: [],
      };
      entry.types.add(inferType(value));
      entry.occurrences += 1;
      if (entry.examples.length < MAX_EXAMPLES) {
        entry.examples.push(summarizeForExample(value));
      }
      fieldMap.set(name, entry);
    }
  }

  const fields: SchemaField[] = Array.from(fieldMap.entries())
    .map(([name, { types, occurrences, examples }]) => ({
      name,
      types: Array.from(types),
      occurrences,
      examples,
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  return {
    collection: req.collection,
    collectionGroup: req.collectionGroup ?? false,
    sampledCount: snap.size,
    sampledAt: Date.now(),
    fields,
  };
}

function schemaOverrideKey(
  profileId: string,
  collection: string,
  collectionGroup: boolean,
): string {
  return `${collection}|${collectionGroup ? 'cg' : 'c'}|${profileId}`;
}

export async function schemaSample(
  req: SchemaSampleRequest,
): Promise<CollectionSchema> {
  const { firestore, profileId } = await getFirestoreForActive();
  const schema = await sampleSchema(firestore, req);
  // Surface any saved override/notes on top of the fresh sample so the UI
  // doesn't appear to forget user tweaks on re-sample.
  const override = await loadOverride(profileId, req.collection, req.collectionGroup);
  return override ? { ...schema, ...override } : schema;
}

export async function schemaGet(
  req: SchemaGetRequest,
): Promise<CollectionSchema | null> {
  // On web we don't persist full samples — they're cheap to regenerate and
  // tend to drift. We only return overrides. Callers use this for the
  // "already edited?" flag in the Schema tab.
  try {
    const profileId = await getActiveProfileId();
    if (!profileId) return null;
    const override = await loadOverride(
      profileId,
      req.collection,
      req.collectionGroup,
    );
    if (!override) return null;
    return {
      collection: req.collection,
      collectionGroup: req.collectionGroup ?? false,
      sampledCount: 0,
      sampledAt: 0,
      fields: [],
      ...override,
    };
  } catch (err) {
    if (err instanceof WebProfileNotConfiguredError) return null;
    throw err;
  }
}

export async function schemaSaveOverride(
  req: SchemaSaveOverrideRequest,
): Promise<CollectionSchema> {
  const profileId = (await getActiveProfileId()) ?? 'web-unset';
  const id = schemaOverrideKey(profileId, req.collection, req.collectionGroup);
  const payload = {
    userOverride: req.userOverride,
    userNotes: req.userNotes,
  };
  const db = await getDb();
  await db.put('schemaOverrides', { id, payload, updatedAt: Date.now() });
  return {
    collection: req.collection,
    collectionGroup: req.collectionGroup ?? false,
    sampledCount: 0,
    sampledAt: 0,
    fields: [],
    userOverride: req.userOverride,
    userNotes: req.userNotes,
  };
}

async function loadOverride(
  profileId: string,
  collection: string,
  collectionGroup: boolean,
): Promise<{ userOverride?: string; userNotes?: string } | null> {
  const db = await getDb();
  const row = await db.get(
    'schemaOverrides',
    schemaOverrideKey(profileId, collection, collectionGroup),
  );
  if (!row) return null;
  return row.payload as { userOverride?: string; userNotes?: string };
}
