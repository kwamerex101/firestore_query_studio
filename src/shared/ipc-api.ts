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
} from './types/ipc';
import {
  Profile,
  ProfileInput,
  ProfileUpdate,
  LlmSettings,
  CursorSettings,
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
} as const;

export type IpcApi = typeof ipcApi;

export type IpcChannel = keyof IpcApi;

export type IpcRequest<C extends IpcChannel> = z.infer<IpcApi[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.infer<IpcApi[C]['response']>;

export { IpcChannels };
