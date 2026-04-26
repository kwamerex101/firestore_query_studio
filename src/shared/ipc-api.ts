import { z } from 'zod';
import {
  IpcChannels,
  PlanRequest,
  PlanBuildOutcome,
  ExecuteRequest,
  SchemaSampleRequest,
  SchemaSaveOverrideRequest,
  SchemaGetRequest,
  ActiveProfileResult,
  SetActiveProfileRequest,
  LlmGetResult,
  LlmWarmupOutcome,
  CursorGetResult,
  CursorListModelsResult,
  CursorTestOutcome,
  ClaudeGetResult,
  ClaudeListModelsResult,
  ClaudeTestOutcome,
  SheetsStateResult,
  SheetsSignInOutcome,
  SheetsExportCreateRequest,
  SheetsExportCreateOutcome,
  SheetsExportAppendRequest,
  SheetsExportAppendOutcome,
  ProviderResult,
  HistoryListRequest,
  HistoryListResult,
  HistoryGetRequest,
  HistoryGetResult,
  HistoryAddRequest,
  HistoryAddResult,
  HistoryClearResult,
  HistoryFindCachedRequest,
  HistoryFindCachedResult,
  InsightsGenerateRequest,
  InsightsGenerateOutcome,
  VisualsGenerateRequest,
  VisualsGenerateOutcome,
  DbTestConnectionRequest,
  DbTestConnectionOutcome,
  DbProbeSqlDatabasesRequest,
  DbProbeSqlDatabasesOutcome,
  DbProbeSqlSchemasRequest,
  DbProbeSqlSchemasOutcome,
  DbListContainersResult,
  SqlPlanRequest,
  SqlPlanBuildOutcome,
  SqlExecuteRequest,
  SqlExecuteOutcome,
  SqlSampleTableRequest,
  SqlSampleTableResult,
  PickServiceAccountResult,
  PickDataFileResult,
  ValidateServiceAccountRequest,
  ValidateServiceAccountResult,
  ImportServiceAccountRequest,
  ImportServiceAccountResult,
  SqlStreamStartRequest,
  SqlStreamStartOutcome,
  ExecuteStreamStartRequest,
  ExecuteStreamStartOutcome,
  StreamCancelRequest,
  ExportStartRequest,
  ExportStartOutcome,
  RtdbReadRequest,
  RtdbReadOutcome,
} from './types/ipc';
import {
  Profile,
  ProfileInput,
  ProfileUpdate,
  LlmSettings,
  CursorSettings,
  ClaudeSettings,
  GoogleSheetsSettings,
  LlmProvider,
} from './types/profile';
import { CollectionSchema } from './types/schema';
import { RunOutcome } from './types/results';

const Void = z.undefined();
const OkAck = z.object({ ok: z.literal(true) });

const ProfileUpdateRequest = z.object({
  id: z.string().min(1),
  update: ProfileUpdate,
});

const ProfileDeleteRequest = z.object({
  id: z.string().min(1),
});

/**
 * Declarative IPC surface. Mapping of channel name to request/response
 * Zod schemas used on both sides of the contextBridge.
 */
export const ipcApi = {
  [IpcChannels.profilesList]: {
    request: Void,
    response: z.array(Profile),
  },
  [IpcChannels.profilesCreate]: {
    request: ProfileInput,
    response: Profile,
  },
  [IpcChannels.profilesUpdate]: {
    request: ProfileUpdateRequest,
    response: Profile,
  },
  [IpcChannels.profilesDelete]: {
    request: ProfileDeleteRequest,
    response: OkAck,
  },
  [IpcChannels.profilesSetActive]: {
    request: SetActiveProfileRequest,
    response: ActiveProfileResult,
  },
  [IpcChannels.profilesGetActive]: {
    request: Void,
    response: ActiveProfileResult,
  },
  [IpcChannels.llmGet]: {
    request: Void,
    response: LlmGetResult,
  },
  [IpcChannels.llmSet]: {
    request: LlmSettings,
    response: LlmGetResult,
  },
  [IpcChannels.llmWarmup]: {
    request: Void,
    response: LlmWarmupOutcome,
  },
  [IpcChannels.cursorGet]: {
    request: Void,
    response: CursorGetResult,
  },
  [IpcChannels.cursorSet]: {
    request: CursorSettings,
    response: CursorGetResult,
  },
  [IpcChannels.cursorListModels]: {
    request: Void,
    response: CursorListModelsResult,
  },
  [IpcChannels.cursorTest]: {
    request: CursorSettings.optional(),
    response: CursorTestOutcome,
  },
  [IpcChannels.claudeGet]: {
    request: Void,
    response: ClaudeGetResult,
  },
  [IpcChannels.claudeSet]: {
    request: ClaudeSettings,
    response: ClaudeGetResult,
  },
  [IpcChannels.claudeListModels]: {
    request: Void,
    response: ClaudeListModelsResult,
  },
  [IpcChannels.claudeTest]: {
    request: ClaudeSettings.optional(),
    response: ClaudeTestOutcome,
  },
  [IpcChannels.sheetsGet]: {
    request: Void,
    response: SheetsStateResult,
  },
  [IpcChannels.sheetsSet]: {
    request: GoogleSheetsSettings,
    response: SheetsStateResult,
  },
  [IpcChannels.sheetsSignIn]: {
    request: Void,
    response: SheetsSignInOutcome,
  },
  [IpcChannels.sheetsSignOut]: {
    request: Void,
    response: SheetsStateResult,
  },
  [IpcChannels.sheetsExportCreate]: {
    request: SheetsExportCreateRequest,
    response: SheetsExportCreateOutcome,
  },
  [IpcChannels.sheetsExportAppend]: {
    request: SheetsExportAppendRequest,
    response: SheetsExportAppendOutcome,
  },
  [IpcChannels.providerGet]: {
    request: Void,
    response: ProviderResult,
  },
  [IpcChannels.providerSet]: {
    request: z.object({ provider: LlmProvider }),
    response: ProviderResult,
  },
  [IpcChannels.schemaSample]: {
    request: SchemaSampleRequest,
    response: CollectionSchema,
  },
  [IpcChannels.schemaGet]: {
    request: SchemaGetRequest,
    response: CollectionSchema.nullable(),
  },
  [IpcChannels.schemaSaveOverride]: {
    request: SchemaSaveOverrideRequest,
    response: CollectionSchema,
  },
  [IpcChannels.planBuild]: {
    request: PlanRequest,
    response: PlanBuildOutcome,
  },
  [IpcChannels.executeRun]: {
    request: ExecuteRequest,
    response: RunOutcome,
  },
  [IpcChannels.collectionsList]: {
    request: Void,
    response: z.array(z.string()),
  },
  [IpcChannels.dbTestConnection]: {
    request: DbTestConnectionRequest,
    response: DbTestConnectionOutcome,
  },
  [IpcChannels.dbProbeSqlDatabases]: {
    request: DbProbeSqlDatabasesRequest,
    response: DbProbeSqlDatabasesOutcome,
  },
  [IpcChannels.dbProbeSqlSchemas]: {
    request: DbProbeSqlSchemasRequest,
    response: DbProbeSqlSchemasOutcome,
  },
  [IpcChannels.dbListContainers]: {
    request: Void,
    response: DbListContainersResult,
  },
  [IpcChannels.dbExecuteSql]: {
    request: SqlExecuteRequest,
    response: SqlExecuteOutcome,
  },
  [IpcChannels.dbSampleTable]: {
    request: SqlSampleTableRequest,
    response: SqlSampleTableResult,
  },
  [IpcChannels.planBuildSql]: {
    request: SqlPlanRequest,
    response: SqlPlanBuildOutcome,
  },
  [IpcChannels.historyList]: {
    request: HistoryListRequest,
    response: HistoryListResult,
  },
  [IpcChannels.historyGet]: {
    request: HistoryGetRequest,
    response: HistoryGetResult,
  },
  [IpcChannels.historyAdd]: {
    request: HistoryAddRequest,
    response: HistoryAddResult,
  },
  [IpcChannels.historyClear]: {
    request: Void,
    response: HistoryClearResult,
  },
  [IpcChannels.historyFindCached]: {
    request: HistoryFindCachedRequest,
    response: HistoryFindCachedResult,
  },
  [IpcChannels.insightsGenerate]: {
    request: InsightsGenerateRequest,
    response: InsightsGenerateOutcome,
  },
  [IpcChannels.visualsGenerate]: {
    request: VisualsGenerateRequest,
    response: VisualsGenerateOutcome,
  },
  [IpcChannels.dialogPickServiceAccount]: {
    request: Void,
    response: PickServiceAccountResult,
  },
  [IpcChannels.dialogValidateServiceAccount]: {
    request: ValidateServiceAccountRequest,
    response: ValidateServiceAccountResult,
  },
  [IpcChannels.dialogImportServiceAccount]: {
    request: ImportServiceAccountRequest,
    response: ImportServiceAccountResult,
  },
  [IpcChannels.dialogPickDataFile]: {
    request: Void,
    response: PickDataFileResult,
  },
  [IpcChannels.sqlStreamStart]: {
    request: SqlStreamStartRequest,
    response: SqlStreamStartOutcome,
  },
  [IpcChannels.executeStreamStart]: {
    request: ExecuteStreamStartRequest,
    response: ExecuteStreamStartOutcome,
  },
  [IpcChannels.streamCancel]: {
    request: StreamCancelRequest,
    response: OkAck,
  },
  [IpcChannels.exportStart]: {
    request: ExportStartRequest,
    response: ExportStartOutcome,
  },
  [IpcChannels.exportCancel]: {
    request: StreamCancelRequest,
    response: OkAck,
  },
  [IpcChannels.rtdbRead]: {
    request: RtdbReadRequest,
    response: RtdbReadOutcome,
  },
} as const;

export type IpcApi = typeof ipcApi;

export type IpcChannel = keyof IpcApi;

export type IpcRequest<C extends IpcChannel> = z.infer<IpcApi[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.infer<IpcApi[C]['response']>;

export { IpcChannels };
