import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '@shared/types/ipc';

const invoke = (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload);

/**
 * Hand-rolled typed surface. The renderer imports types from '@shared/ipc-api'
 * for compile-time inference; at runtime we just call ipcRenderer.invoke.
 */
const api = {
  profiles: {
    list: () => invoke(IpcChannels.profilesList, undefined),
    create: (input: unknown) => invoke(IpcChannels.profilesCreate, input),
    update: (req: unknown) => invoke(IpcChannels.profilesUpdate, req),
    delete: (req: unknown) => invoke(IpcChannels.profilesDelete, req),
    setActive: (req: unknown) => invoke(IpcChannels.profilesSetActive, req),
    getActive: () => invoke(IpcChannels.profilesGetActive, undefined),
  },
  llm: {
    get: () => invoke(IpcChannels.llmGet, undefined),
    set: (input: unknown) => invoke(IpcChannels.llmSet, input),
    warmup: () => invoke(IpcChannels.llmWarmup, undefined),
  },
  cursor: {
    get: () => invoke(IpcChannels.cursorGet, undefined),
    set: (input: unknown) => invoke(IpcChannels.cursorSet, input),
    listModels: () => invoke(IpcChannels.cursorListModels, undefined),
    test: (input?: unknown) => invoke(IpcChannels.cursorTest, input),
  },
  provider: {
    get: () => invoke(IpcChannels.providerGet, undefined),
    set: (input: unknown) => invoke(IpcChannels.providerSet, input),
  },
  schema: {
    sample: (input: unknown) => invoke(IpcChannels.schemaSample, input),
    get: (input: unknown) => invoke(IpcChannels.schemaGet, input),
    saveOverride: (input: unknown) => invoke(IpcChannels.schemaSaveOverride, input),
  },
  plan: {
    build: (input: unknown) => invoke(IpcChannels.planBuild, input),
  },
  execute: {
    run: (input: unknown) => invoke(IpcChannels.executeRun, input),
  },
  collections: {
    list: () => invoke(IpcChannels.collectionsList, undefined),
  },
  history: {
    list: (input: unknown) => invoke(IpcChannels.historyList, input ?? {}),
    get: (input: unknown) => invoke(IpcChannels.historyGet, input),
    add: (input: unknown) => invoke(IpcChannels.historyAdd, input),
    clear: () => invoke(IpcChannels.historyClear, undefined),
    findCached: (input: unknown) => invoke(IpcChannels.historyFindCached, input),
  },
  insights: {
    generate: (input: unknown) => invoke(IpcChannels.insightsGenerate, input),
  },
} as const;

contextBridge.exposeInMainWorld('fqs', api);

export type FqsApi = typeof api;
