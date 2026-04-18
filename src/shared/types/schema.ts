import { z } from 'zod';

export const InferredType = z.enum([
  'string',
  'number',
  'boolean',
  'null',
  'timestamp',
  'geopoint',
  'reference',
  'array',
  'map',
  'bytes',
  'unknown',
]);
export type InferredType = z.infer<typeof InferredType>;

export const SchemaField = z.object({
  name: z.string().min(1),
  types: z.array(InferredType).min(1),
  occurrences: z.number().int().nonnegative(),
  examples: z.array(z.unknown()).max(5).default([]),
  note: z.string().optional(),
});
export type SchemaField = z.infer<typeof SchemaField>;

export const CollectionSchema = z.object({
  collection: z.string().min(1),
  collectionGroup: z.boolean().default(false),
  sampledCount: z.number().int().nonnegative(),
  sampledAt: z.number().int(),
  fields: z.array(SchemaField).default([]),
  userNotes: z.string().optional(),
  userOverride: z.string().optional(),
});
export type CollectionSchema = z.infer<typeof CollectionSchema>;
