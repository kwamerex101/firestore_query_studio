import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import type { CollectionSchema } from '@shared/types/schema';
import { sampleCollection } from './schemaSampler';

type CacheFile = {
  version: 1;
  entries: Record<string, CollectionSchema>;
};

function cachePath(profileId: string): string {
  return join(app.getPath('userData'), `schema-cache.${profileId}.json`);
}

function keyFor(collection: string, collectionGroup: boolean): string {
  return `${collectionGroup ? 'cg' : 'c'}:${collection}`;
}

async function readCache(profileId: string): Promise<CacheFile> {
  try {
    const raw = await fs.readFile(cachePath(profileId), 'utf8');
    return JSON.parse(raw) as CacheFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, entries: {} };
    }
    throw err;
  }
}

async function writeCache(profileId: string, data: CacheFile): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(cachePath(profileId), JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
}

export async function getCachedSchema(
  profileId: string,
  collection: string,
  collectionGroup: boolean,
): Promise<CollectionSchema | null> {
  const data = await readCache(profileId);
  return data.entries[keyFor(collection, collectionGroup)] ?? null;
}

export async function setCachedSchema(
  profileId: string,
  schema: CollectionSchema,
): Promise<void> {
  const data = await readCache(profileId);
  data.entries[keyFor(schema.collection, schema.collectionGroup ?? false)] = schema;
  await writeCache(profileId, data);
}

export async function clearCacheForProfile(profileId: string): Promise<void> {
  try {
    await fs.unlink(cachePath(profileId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export interface EnsureSchemaOptions {
  profileId: string;
  firestore: Firestore;
  collection: string;
  collectionGroup?: boolean;
  sampleSize?: number;
  /**
   * If true, bypass an existing cache and re-sample. Defaults to false.
   */
  force?: boolean;
}

/**
 * Return a cached schema for the given collection if one exists, otherwise
 * sample the collection once, cache the result, and return it.
 *
 * This is the canonical path used during planBuild and executeRun so we
 * never try to plan or decode a filter on an unknown-shaped collection.
 * Errors during sampling are swallowed and null is returned so the calling
 * pipeline can degrade gracefully (LLM just gets no schema hint).
 */
export async function ensureSchema(opts: EnsureSchemaOptions): Promise<CollectionSchema | null> {
  const { profileId, firestore, collection, collectionGroup = false, sampleSize, force = false } = opts;
  if (!force) {
    const cached = await getCachedSchema(profileId, collection, collectionGroup);
    if (cached) return cached;
  }
  try {
    const schema = await sampleCollection({
      firestore,
      collection,
      collectionGroup,
      sampleSize,
    });
    // Preserve any existing user override/notes so auto-sampling never
    // clobbers manual work the developer did in the Schema tab.
    const existing = await getCachedSchema(profileId, collection, collectionGroup);
    const merged = existing?.userOverride
      ? { ...schema, userOverride: existing.userOverride, userNotes: existing.userNotes }
      : schema;
    await setCachedSchema(profileId, merged);
    return merged;
  } catch {
    return null;
  }
}
