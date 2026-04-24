import { z } from 'zod';
import {
  Profile,
  ProfileInput,
  ProfileUpdate,
  LlmSettings,
  LlmProvider,
  CursorSettings,
  ClaudeSettings,
  SslMode,
} from './profile';
import { CollectionSchema } from './schema';
import { QueryPlan } from './plan';
import { RunOutcome } from './results';
import { HistoryEntry, HistorySummary } from './history';
import { SqlColumn, SqlRow, SqlExecuteOutcome } from './sqlExecute';
import { SqlPlan, SqlTableSampleView } from './sqlPlan';
import { VisualPlan } from './visualPlan';

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
  claudeGet: 'claude.get',
  claudeSet: 'claude.set',
  claudeListModels: 'claude.listModels',
  claudeTest: 'claude.test',
  providerGet: 'provider.get',
  providerSet: 'provider.set',
  schemaSample: 'schema.sample',
  schemaGet: 'schema.get',
  schemaSaveOverride: 'schema.saveOverride',
  planBuild: 'plan.build',
  executeRun: 'execute.run',
  collectionsList: 'collections.list',
  dbTestConnection: 'db.testConnection',
  dbProbeSqlDatabases: 'db.probeSqlDatabases',
  dbProbeSqlSchemas: 'db.probeSqlSchemas',
  dbListContainers: 'db.listContainers',
  dbExecuteSql: 'db.executeSql',
  dbSampleTable: 'db.sampleTable',
  planBuildSql: 'plan.buildSql',
  historyList: 'history.list',
  historyGet: 'history.get',
  historyAdd: 'history.add',
  historyClear: 'history.clear',
  historyFindCached: 'history.findCached',
  insightsGenerate: 'insights.generate',
  visualsGenerate: 'visuals.generate',
  dialogPickServiceAccount: 'dialog.pickServiceAccount',
  dialogValidateServiceAccount: 'dialog.validateServiceAccount',
  dialogImportServiceAccount: 'dialog.importServiceAccount',
  // Streaming run (SQL + Firestore) + cancel. Batch events are pushed by
  // main as `stream.batch.<runId>` / `stream.done.<runId>` /
  // `stream.error.<runId>`; the renderer subscribes via the preload
  // `streams.subscribe(...)` helper.
  sqlStreamStart: 'sql.stream.start',
  executeStreamStart: 'execute.stream.start',
  streamCancel: 'stream.cancel',
  exportStart: 'export.start',
  exportCancel: 'export.cancel',
} as const;

/**
 * Event channel templates for stream batches. The `<runId>` suffix
 * isolates concurrent runs without needing a shared routing table.
 */
export const StreamEventChannels = {
  batch: (runId: string): string => `stream.batch.${runId}`,
  done: (runId: string): string => `stream.done.${runId}`,
  error: (runId: string): string => `stream.error.${runId}`,
  exportProgress: (runId: string): string => `export.progress.${runId}`,
  exportDone: (runId: string): string => `export.done.${runId}`,
  exportError: (runId: string): string => `export.error.${runId}`,
} as const;

/**
 * One row batch pushed from main to renderer during a streaming run.
 * Rows are encoded as tuples (`SqlCell[][]` for SQL, `unknown[][]` for
 * Firestore after column projection) alongside the column order so the
 * renderer can materialize them into a bounded tuple store without
 * rebuilding per-row objects.
 */
export const StreamBatchEvent = z.object({
  runId: z.string().min(1),
  rowIndexStart: z.number().int().nonnegative(),
  rows: z.array(z.array(z.any())),
  /** Only present on the very first batch — columns are stable after that. */
  columns: z.array(z.object({
    name: z.string(),
    dataType: z.string().optional(),
  })).optional(),
});
export type StreamBatchEvent = z.infer<typeof StreamBatchEvent>;

export const StreamDoneEvent = z.object({
  runId: z.string().min(1),
  totalRows: z.number().int().nonnegative(),
  /** Rows actually delivered to the renderer (capped at uiLimit). */
  deliveredRows: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  /** True if driver hit `hardLimit` or cap before exhausting the source. */
  truncated: z.boolean(),
  /** True if renderer window hit `uiLimit` while source kept going. */
  uiTruncated: z.boolean(),
  warnings: z.array(z.string()).default([]),
});
export type StreamDoneEvent = z.infer<typeof StreamDoneEvent>;

export const StreamErrorEvent = z.object({
  runId: z.string().min(1),
  code: z.string(),
  message: z.string(),
  elapsedMs: z.number().int().nonnegative(),
  executedSql: z.string().optional(),
});
export type StreamErrorEvent = z.infer<typeof StreamErrorEvent>;

export const ExportProgressEvent = z.object({
  runId: z.string().min(1),
  rowsWritten: z.number().int().nonnegative(),
  bytesWritten: z.number().int().nonnegative(),
});
export type ExportProgressEvent = z.infer<typeof ExportProgressEvent>;

export const ExportDoneEvent = z.object({
  runId: z.string().min(1),
  path: z.string().min(1),
  rowsWritten: z.number().int().nonnegative(),
  bytesWritten: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type ExportDoneEvent = z.infer<typeof ExportDoneEvent>;

export const ExportErrorEvent = z.object({
  runId: z.string().min(1),
  code: z.string(),
  message: z.string(),
  elapsedMs: z.number().int().nonnegative(),
});
export type ExportErrorEvent = z.infer<typeof ExportErrorEvent>;

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

export const ClaudeGetResult = ClaudeSettings.partial().extend({
  isConfigured: z.boolean(),
});
export type ClaudeGetResult = z.infer<typeof ClaudeGetResult>;

export const ClaudeModelItem = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type ClaudeModelItem = z.infer<typeof ClaudeModelItem>;

export const ClaudeListModelsResult = z.object({
  models: z.array(ClaudeModelItem),
  source: z.enum(['cli', 'fallback']),
  error: z.string().optional(),
});
export type ClaudeListModelsResult = z.infer<typeof ClaudeListModelsResult>;

export const ClaudeTestOk = z.object({
  ok: z.literal(true),
  version: z.string().optional(),
  stdout: z.string().optional(),
});
export const ClaudeTestErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
});
export const ClaudeTestOutcome = z.discriminatedUnion('ok', [ClaudeTestOk, ClaudeTestErr]);
export type ClaudeTestOutcome = z.infer<typeof ClaudeTestOutcome>;

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

export const HistoryAddFirestoreRequest = z.object({
  source: z.literal('firestore'),
  question: z.string().min(1),
  collection: z.string().optional(),
  plan: QueryPlan,
  outcome: RunOutcome,
});
export const HistoryAddSqlRequest = z.object({
  source: z.literal('sql'),
  question: z.string().min(1),
  sqlPlan: SqlPlan,
  outcome: SqlExecuteOutcome,
});
export const HistoryAddRequest = z.discriminatedUnion('source', [
  HistoryAddFirestoreRequest,
  HistoryAddSqlRequest,
]);
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
 * Test that a profile's connection works. `profileId` is optional — when
 * omitted we test the current active profile. Used by the "Test connection"
 * button in the profile dialog before saving.
 */
export const DbTestConnectionRequest = z.object({
  profileId: z.string().min(1).optional(),
});
export type DbTestConnectionRequest = z.infer<typeof DbTestConnectionRequest>;

export const DbTestConnectionOk = z.object({
  ok: z.literal(true),
  elapsedMs: z.number().int().nonnegative(),
  detail: z.string().optional(),
});
export const DbTestConnectionErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  elapsedMs: z.number().int().nonnegative(),
});
export const DbTestConnectionOutcome = z.discriminatedUnion('ok', [
  DbTestConnectionOk,
  DbTestConnectionErr,
]);
export type DbTestConnectionOutcome = z.infer<typeof DbTestConnectionOutcome>;

/**
 * Draft connection parameters for a SQL probe (list databases / list
 * schemas). Carries just enough to open a temporary pool outside the
 * normal profile lifecycle — the profile doesn't exist yet (New dialog)
 * or the user is editing fields before Save. Plaintext `password` flows
 * on IPC exactly once, same as `profiles.create`/`profiles.update`.
 */
export const SqlProbeDraft = z.object({
  engine: z.enum(['postgres', 'mysql', 'mssql']),
  host: z.string().min(1),
  port: z.number().int().positive(),
  user: z.string().min(1),
  /**
   * Plaintext password. When empty/omitted AND a `profileId` is also
   * present, the main process falls back to the keychain secret for
   * that profile.
   */
  password: z.string().optional(),
  sslMode: SslMode.default('disable'),
  // MSSQL-only extras. Safe to carry on other engines too; ignored there.
  encrypt: z.boolean().optional(),
  trustServerCertificate: z.boolean().optional(),
  instanceName: z.string().optional(),
});
export type SqlProbeDraft = z.infer<typeof SqlProbeDraft>;

/**
 * List the databases the user can connect to on a SQL server. Either
 * `profileId` or `draft` must be provided — typically `draft` for the
 * New-profile dialog, `profileId` (+ optional draft overrides) when
 * editing an existing profile without retyping the password.
 */
export const DbProbeSqlDatabasesRequest = z.object({
  profileId: z.string().min(1).optional(),
  draft: SqlProbeDraft.optional(),
});
export type DbProbeSqlDatabasesRequest = z.infer<typeof DbProbeSqlDatabasesRequest>;

export const DbProbeSqlDatabasesOk = z.object({
  ok: z.literal(true),
  databases: z.array(z.string()),
  elapsedMs: z.number().int().nonnegative(),
});
export const DbProbeSqlDatabasesErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  elapsedMs: z.number().int().nonnegative(),
});
export const DbProbeSqlDatabasesOutcome = z.discriminatedUnion('ok', [
  DbProbeSqlDatabasesOk,
  DbProbeSqlDatabasesErr,
]);
export type DbProbeSqlDatabasesOutcome = z.infer<typeof DbProbeSqlDatabasesOutcome>;

/**
 * List the schemas inside a specific database. Postgres returns real
 * schemas; MSSQL returns `sys.schemas`; MySQL has no distinct schema
 * layer so its handler rejects with `UNSUPPORTED_ENGINE`.
 */
export const DbProbeSqlSchemasRequest = z.object({
  profileId: z.string().min(1).optional(),
  draft: SqlProbeDraft.optional(),
  database: z.string().min(1),
});
export type DbProbeSqlSchemasRequest = z.infer<typeof DbProbeSqlSchemasRequest>;

export const DbProbeSqlSchemasOk = z.object({
  ok: z.literal(true),
  schemas: z.array(z.string()),
  elapsedMs: z.number().int().nonnegative(),
});
export const DbProbeSqlSchemasErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  elapsedMs: z.number().int().nonnegative(),
});
export const DbProbeSqlSchemasOutcome = z.discriminatedUnion('ok', [
  DbProbeSqlSchemasOk,
  DbProbeSqlSchemasErr,
]);
export type DbProbeSqlSchemasOutcome = z.infer<typeof DbProbeSqlSchemasOutcome>;

export const DbContainer = z.object({
  name: z.string(),
  schema: z.string().nullable(),
  tableType: z.string(),
});
export type DbContainer = z.infer<typeof DbContainer>;

export const DbListContainersResult = z.object({
  containers: z.array(DbContainer),
});
export type DbListContainersResult = z.infer<typeof DbListContainersResult>;

/**
 * Native file picker for the service-account JSON. Request is void; response
 * is a discriminated union of { canceled: true } | { canceled: false, path }.
 */
export const PickServiceAccountCanceled = z.object({
  canceled: z.literal(true),
});
export const PickServiceAccountPicked = z.object({
  canceled: z.literal(false),
  path: z.string().min(1),
});
export const PickServiceAccountResult = z.discriminatedUnion('canceled', [
  PickServiceAccountCanceled,
  PickServiceAccountPicked,
]);
export type PickServiceAccountResult = z.infer<typeof PickServiceAccountResult>;

export const ValidateServiceAccountRequest = z.object({
  path: z.string().min(1),
});
export type ValidateServiceAccountRequest = z.infer<typeof ValidateServiceAccountRequest>;

export const ValidateServiceAccountOk = z.object({
  ok: z.literal(true),
  path: z.string().min(1),
  projectId: z.string().min(1),
  clientEmail: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});
export const ValidateServiceAccountErr = z.object({
  ok: z.literal(false),
  path: z.string().min(1),
  code: z.enum(['NOT_FOUND', 'TOO_LARGE', 'INVALID_JSON', 'MISSING_FIELDS', 'UNKNOWN']),
  message: z.string(),
});
export const ValidateServiceAccountResult = z.discriminatedUnion('ok', [
  ValidateServiceAccountOk,
  ValidateServiceAccountErr,
]);
export type ValidateServiceAccountResult = z.infer<typeof ValidateServiceAccountResult>;

export const ImportServiceAccountRequest = z.object({
  path: z.string().min(1),
  profileId: z.string().min(1),
});
export type ImportServiceAccountRequest = z.infer<typeof ImportServiceAccountRequest>;

export const ImportServiceAccountResult = z.object({
  path: z.string().min(1),
});
export type ImportServiceAccountResult = z.infer<typeof ImportServiceAccountResult>;

/**
 * SQL-dialect query planner. Mirrors the Firestore `PlanRequest`/
 * `PlanBuildOutcome` pair but carries an `SqlPlan` instead of a
 * Firestore `QueryPlan`. The renderer picks which channel to call based
 * on the active profile's engine.
 */
export const SqlPlanRequest = z.object({
  question: z.string().min(1),
  /**
   * Target table hint. When present, the planner narrows its schema
   * snapshot to just this table instead of sampling every container.
   */
  table: z.string().min(1).optional(),
  allowScan: z.boolean().default(true),
});
export type SqlPlanRequest = z.infer<typeof SqlPlanRequest>;

export const SqlPlanBuildOk = z.object({
  ok: z.literal(true),
  plan: SqlPlan,
  rawResponse: z.string().optional(),
});
export const SqlPlanBuildErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  rawResponse: z.string().optional(),
});
export const SqlPlanBuildOutcome = z.discriminatedUnion('ok', [
  SqlPlanBuildOk,
  SqlPlanBuildErr,
]);
export type SqlPlanBuildOutcome = z.infer<typeof SqlPlanBuildOutcome>;

/**
 * Execute a single read-only SQL statement. The driver validates the
 * statement with `sqlSafety` and clamps the row cap before running it;
 * the renderer should still prefer plans produced by the SQL planner
 * rather than free-form user input.
 */
export const SqlExecuteRequest = z.object({
  sql: z.string().min(1),
  /**
   * Optional per-call row cap. If unset, the driver uses the profile's
   * `defaultLimit`. The driver further clamps to `defaultLimit` either
   * way. Historically 50k; raised to 10M so the streaming IPC path can
   * flush very large result sets — the non-streaming `runReadOnlyQuery`
   * still materializes in memory and should stay small.
   */
  limit: z.number().int().positive().max(10_000_000).optional(),
});
export type SqlExecuteRequest = z.infer<typeof SqlExecuteRequest>;

/**
 * Kick off a streaming SQL run. The main process validates the SQL,
 * opens a driver-level cursor / stream, and pushes row batches to the
 * renderer as `stream.batch.<runId>` events. The initial response
 * contains only metadata; rows arrive asynchronously.
 */
export const SqlStreamStartRequest = z.object({
  sql: z.string().min(1),
  /** How many rows the renderer will keep (default 50_000, max 200_000). */
  uiLimit: z.number().int().positive().max(200_000).optional(),
  /** Overall row ceiling (default = uiLimit; max 10M). */
  hardLimit: z.number().int().positive().max(10_000_000).optional(),
  /** Rows per IPC batch (default 5_000, max 50_000). */
  batchSize: z.number().int().positive().max(50_000).optional(),
});
export type SqlStreamStartRequest = z.infer<typeof SqlStreamStartRequest>;

export const SqlStreamStartOk = z.object({
  ok: z.literal(true),
  runId: z.string().min(1),
  uiLimit: z.number().int().positive(),
  hardLimit: z.number().int().positive(),
});
export const SqlStreamStartErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  executedSql: z.string().optional(),
});
export const SqlStreamStartOutcome = z.discriminatedUnion('ok', [
  SqlStreamStartOk,
  SqlStreamStartErr,
]);
export type SqlStreamStartOutcome = z.infer<typeof SqlStreamStartOutcome>;

export const StreamCancelRequest = z.object({
  runId: z.string().min(1),
});
export type StreamCancelRequest = z.infer<typeof StreamCancelRequest>;

/**
 * Firestore streaming counterpart of `SqlStreamStartRequest`. Mirrors
 * the contract: main opens a cursor (`q.stream()` in Admin, cursor
 * pagination via `startAfter` on web) and emits row batches to the
 * renderer keyed by runId.
 */
export const ExecuteStreamStartRequest = z.object({
  plan: QueryPlan,
  uiLimit: z.number().int().positive().max(200_000).optional(),
  hardLimit: z.number().int().positive().max(10_000_000).optional(),
  batchSize: z.number().int().positive().max(50_000).optional(),
});
export type ExecuteStreamStartRequest = z.infer<typeof ExecuteStreamStartRequest>;

export const ExecuteStreamStartOk = z.object({
  ok: z.literal(true),
  runId: z.string().min(1),
  uiLimit: z.number().int().positive(),
  hardLimit: z.number().int().positive(),
});
export const ExecuteStreamStartErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
});
export const ExecuteStreamStartOutcome = z.discriminatedUnion('ok', [
  ExecuteStreamStartOk,
  ExecuteStreamStartErr,
]);
export type ExecuteStreamStartOutcome = z.infer<typeof ExecuteStreamStartOutcome>;

/**
 * Stream-to-disk export. Main process streams rows from the driver
 * directly into a CSV / NDJSON / JSON-array file on disk using Node
 * backpressure, never materializing the full set in the renderer.
 */
export const ExportFormat = z.enum(['csv', 'ndjson', 'json-array']);
export type ExportFormat = z.infer<typeof ExportFormat>;

export const ExportStartSqlRequest = z.object({
  source: z.literal('sql'),
  sql: z.string().min(1),
  format: ExportFormat,
  /** Overall row ceiling for the export (default 10M, max 10M). */
  hardLimit: z.number().int().positive().max(10_000_000).optional(),
  /** Optional absolute path to write to; when omitted the main shows a save dialog. */
  path: z.string().optional(),
});
export const ExportStartFirestoreRequest = z.object({
  source: z.literal('firestore'),
  plan: QueryPlan,
  format: ExportFormat,
  hardLimit: z.number().int().positive().max(10_000_000).optional(),
  path: z.string().optional(),
});
export const ExportStartRequest = z.discriminatedUnion('source', [
  ExportStartSqlRequest,
  ExportStartFirestoreRequest,
]);
export type ExportStartRequest = z.infer<typeof ExportStartRequest>;

export const ExportStartOk = z.object({
  ok: z.literal(true),
  runId: z.string().min(1),
  path: z.string().min(1),
  format: ExportFormat,
});
export const ExportStartErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  /** True if the user canceled the save dialog — not an error per se. */
  canceled: z.boolean().default(false),
});
export const ExportStartOutcome = z.discriminatedUnion('ok', [
  ExportStartOk,
  ExportStartErr,
]);
export type ExportStartOutcome = z.infer<typeof ExportStartOutcome>;

export { SqlColumn, SqlRow, SqlExecuteOk, SqlExecuteErr, SqlExecuteOutcome } from './sqlExecute';

/**
 * Sample a single relational table for schema + a handful of rows. Used
 * by the Query page to build a schema snapshot for the planner prompt.
 */
export const SqlSampleTableRequest = z.object({
  table: z.string().min(1),
  schema: z.string().min(1).optional(),
  sampleSize: z.number().int().positive().max(200).optional(),
});
export type SqlSampleTableRequest = z.infer<typeof SqlSampleTableRequest>;

export const SqlSampleTableResult = z.object({
  sample: SqlTableSampleView.nullable(),
});
export type SqlSampleTableResult = z.infer<typeof SqlSampleTableResult>;

/**
 * AI-generated chart spec plan. The renderer dispatches each spec in
 * the `plan` to a chart component by its `type` discriminator. See
 * `@shared/types/visualPlan` for the full DSL.
 */
export const VisualsGenerateFirestoreRequest = z.object({
  source: z.literal('firestore'),
  question: z.string().min(1),
  collection: z.string().optional(),
  plan: QueryPlan,
  outcome: RunOutcome,
});
export const VisualsGenerateSqlRequest = z.object({
  source: z.literal('sql'),
  question: z.string().min(1),
  sql: z.string().min(1),
  columns: z.array(SqlColumn),
  rows: z.array(SqlRow),
  truncated: z.boolean().default(false),
});
export const VisualsGenerateRequest = z.discriminatedUnion('source', [
  VisualsGenerateFirestoreRequest,
  VisualsGenerateSqlRequest,
]);
export type VisualsGenerateRequest = z.infer<typeof VisualsGenerateRequest>;

export const VisualsGenerateOk = z.object({
  ok: z.literal(true),
  plan: VisualPlan,
  model: z.string().optional(),
  elapsedMs: z.number().int().nonnegative(),
  rowSampleTruncated: z.boolean().default(false),
  specsDropped: z.number().int().nonnegative().default(0),
});
export const VisualsGenerateErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
});
export const VisualsGenerateOutcome = z.discriminatedUnion('ok', [
  VisualsGenerateOk,
  VisualsGenerateErr,
]);
export type VisualsGenerateOutcome = z.infer<typeof VisualsGenerateOutcome>;

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
  ClaudeSettings,
  CollectionSchema,
  QueryPlan,
  RunOutcome,
};
