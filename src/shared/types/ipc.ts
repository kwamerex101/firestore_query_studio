import { z } from 'zod';
import {
  Profile,
  ProfileInput,
  ProfileUpdate,
  LlmSettings,
  LlmProvider,
  CursorSettings,
} from './profile';
import { CollectionSchema } from './schema';
import { QueryPlan } from './plan';
import { RunOutcome } from './results';
import { HistoryEntry, HistorySummary } from './history';

/**
 * IPC channel names. Keep in sync with renderer ipcClient and main router.
 */
export const IpcChannels = {
  profilesList: 'profiles.list',
  profilesCreate: 'profiles.create',
  profilesUpdate: 'profiles.update',
  profilesDelete: 'profiles.delete',
  profilesSetActive: 'profiles.setActive',
  profilesGetActive: 'profiles.getActive',
  llmGet: 'llm.get',
  llmSet: 'llm.set',
  llmWarmup: 'llm.warmup',
  cursorGet: 'cursor.get',
  cursorSet: 'cursor.set',
  cursorListModels: 'cursor.listModels',
  cursorTest: 'cursor.test',
  providerGet: 'provider.get',
  providerSet: 'provider.set',
  schemaSample: 'schema.sample',
  schemaGet: 'schema.get',
  schemaSaveOverride: 'schema.saveOverride',
  planBuild: 'plan.build',
  executeRun: 'execute.run',
  collectionsList: 'collections.list',
  historyList: 'history.list',
  historyGet: 'history.get',
  historyAdd: 'history.add',
  historyClear: 'history.clear',
  historyFindCached: 'history.findCached',
  insightsGenerate: 'insights.generate',
} as const;

export const PlanRequest = z.object({
  question: z.string().min(1),
  collection: z.string().min(1).optional(),
  allowScan: z.boolean().default(true),
  allowMulti: z.boolean().default(true),
});
export type PlanRequest = z.infer<typeof PlanRequest>;

export const PlanBuildOk = z.object({
  ok: z.literal(true),
  plan: QueryPlan,
  rawResponse: z.string().optional(),
});
export const PlanBuildErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  rawResponse: z.string().optional(),
});
export const PlanBuildOutcome = z.discriminatedUnion('ok', [PlanBuildOk, PlanBuildErr]);
export type PlanBuildOutcome = z.infer<typeof PlanBuildOutcome>;

export const ExecuteRequest = z.object({
  plan: QueryPlan,
});
export type ExecuteRequest = z.infer<typeof ExecuteRequest>;

export const SchemaSampleRequest = z.object({
  collection: z.string().min(1),
  collectionGroup: z.boolean().default(false),
  sampleSize: z.number().int().positive().max(200).optional(),
});
export type SchemaSampleRequest = z.infer<typeof SchemaSampleRequest>;

export const SchemaSaveOverrideRequest = z.object({
  collection: z.string().min(1),
  collectionGroup: z.boolean().default(false),
  userOverride: z.string(),
  userNotes: z.string().optional(),
});
export type SchemaSaveOverrideRequest = z.infer<typeof SchemaSaveOverrideRequest>;

export const SchemaGetRequest = z.object({
  collection: z.string().min(1),
  collectionGroup: z.boolean().default(false),
});
export type SchemaGetRequest = z.infer<typeof SchemaGetRequest>;

export const ActiveProfileResult = z.object({
  profileId: z.string().nullable(),
});
export type ActiveProfileResult = z.infer<typeof ActiveProfileResult>;

export const SetActiveProfileRequest = z.object({
  profileId: z.string().nullable(),
});
export type SetActiveProfileRequest = z.infer<typeof SetActiveProfileRequest>;

export const LlmGetResult = LlmSettings.partial().extend({
  hasApiKey: z.boolean(),
});
export type LlmGetResult = z.infer<typeof LlmGetResult>;

export const LlmWarmupOk = z.object({
  ok: z.literal(true),
  elapsedMs: z.number().int().nonnegative(),
  model: z.string().optional(),
});
export const LlmWarmupErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  elapsedMs: z.number().int().nonnegative(),
});
export const LlmWarmupOutcome = z.discriminatedUnion('ok', [LlmWarmupOk, LlmWarmupErr]);
export type LlmWarmupOutcome = z.infer<typeof LlmWarmupOutcome>;

export const CursorGetResult = CursorSettings.partial().extend({
  isConfigured: z.boolean(),
});
export type CursorGetResult = z.infer<typeof CursorGetResult>;

export const CursorModelItem = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type CursorModelItem = z.infer<typeof CursorModelItem>;

export const CursorListModelsResult = z.object({
  models: z.array(CursorModelItem),
  source: z.enum(['cli', 'fallback']),
  error: z.string().optional(),
});
export type CursorListModelsResult = z.infer<typeof CursorListModelsResult>;

export const CursorTestOk = z.object({
  ok: z.literal(true),
  version: z.string().optional(),
  stdout: z.string().optional(),
});
export const CursorTestErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
});
export const CursorTestOutcome = z.discriminatedUnion('ok', [CursorTestOk, CursorTestErr]);
export type CursorTestOutcome = z.infer<typeof CursorTestOutcome>;

export const ProviderResult = z.object({
  provider: LlmProvider,
});
export type ProviderResult = z.infer<typeof ProviderResult>;

export const HistoryListRequest = z.object({
  limit: z.number().int().positive().max(500).optional(),
});
export type HistoryListRequest = z.infer<typeof HistoryListRequest>;

export const HistoryListResult = z.object({
  entries: z.array(HistorySummary),
});
export type HistoryListResult = z.infer<typeof HistoryListResult>;

export const HistoryGetRequest = z.object({
  id: z.string().min(1),
});
export type HistoryGetRequest = z.infer<typeof HistoryGetRequest>;

export const HistoryGetResult = z.object({
  entry: HistoryEntry.nullable(),
});
export type HistoryGetResult = z.infer<typeof HistoryGetResult>;

export const HistoryAddRequest = z.object({
  question: z.string().min(1),
  collection: z.string().optional(),
  plan: QueryPlan,
  outcome: RunOutcome,
});
export type HistoryAddRequest = z.infer<typeof HistoryAddRequest>;

export const HistoryAddResult = z.object({
  entry: HistoryEntry,
});
export type HistoryAddResult = z.infer<typeof HistoryAddResult>;

export const HistoryClearResult = z.object({
  cleared: z.number().int().nonnegative(),
});
export type HistoryClearResult = z.infer<typeof HistoryClearResult>;

export const HistoryFindCachedRequest = z.object({
  question: z.string().min(1),
  collection: z.string().optional(),
});
export type HistoryFindCachedRequest = z.infer<typeof HistoryFindCachedRequest>;

export const HistoryFindCachedResult = z.object({
  entry: HistoryEntry.nullable(),
});
export type HistoryFindCachedResult = z.infer<typeof HistoryFindCachedResult>;

export const InsightsGenerateRequest = z.object({
  question: z.string().min(1),
  plan: QueryPlan,
  outcome: RunOutcome,
  collection: z.string().optional(),
});
export type InsightsGenerateRequest = z.infer<typeof InsightsGenerateRequest>;

export const InsightsGenerateOk = z.object({
  ok: z.literal(true),
  insight: z.string(),
  model: z.string().optional(),
  elapsedMs: z.number().int().nonnegative(),
  /** True when we sent a truncated sample to the LLM instead of all rows. */
  rowSampleTruncated: z.boolean().default(false),
});
export const InsightsGenerateErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
});
export const InsightsGenerateOutcome = z.discriminatedUnion('ok', [
  InsightsGenerateOk,
  InsightsGenerateErr,
]);
export type InsightsGenerateOutcome = z.infer<typeof InsightsGenerateOutcome>;

/**
 * Re-exported types so the renderer has a single import surface.
 */
export type {
  Profile,
  ProfileInput,
  ProfileUpdate,
  LlmSettings,
  LlmProvider,
  CursorSettings,
  CollectionSchema,
  QueryPlan,
  RunOutcome,
};
