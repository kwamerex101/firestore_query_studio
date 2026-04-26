import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IpcChannels, StreamEventChannels } from '@shared/types/ipc';

const invoke = (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload);

/**
 * Hand-rolled typed surface. The renderer imports types from '@shared/ipc-api'
 * for compile-time inference; at runtime we just call ipcRenderer.invoke.
 */
const api = {
  /** See `FqsApi['ipcInvoke']` — used by the Electron transport when `db` is stale after HMR. */
  ipcInvoke: invoke,
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
  claude: {
    get: () => invoke(IpcChannels.claudeGet, undefined),
    set: (input: unknown) => invoke(IpcChannels.claudeSet, input),
    listModels: () => invoke(IpcChannels.claudeListModels, undefined),
    test: (input?: unknown) => invoke(IpcChannels.claudeTest, input),
  },
  sheets: {
    get: () => invoke(IpcChannels.sheetsGet, undefined),
    set: (input: unknown) => invoke(IpcChannels.sheetsSet, input),
    signIn: () => invoke(IpcChannels.sheetsSignIn, undefined),
    signOut: () => invoke(IpcChannels.sheetsSignOut, undefined),
    exportCreate: (input: unknown) => invoke(IpcChannels.sheetsExportCreate, input),
    exportAppend: (input: unknown) => invoke(IpcChannels.sheetsExportAppend, input),
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
    buildSql: (input: unknown) => invoke(IpcChannels.planBuildSql, input),
  },
  execute: {
    run: (input: unknown) => invoke(IpcChannels.executeRun, input),
  },
  collections: {
    list: () => invoke(IpcChannels.collectionsList, undefined),
  },
  rtdb: {
    read: (input: unknown) => invoke(IpcChannels.rtdbRead, input),
  },
  db: {
    testConnection: (input?: unknown) => invoke(IpcChannels.dbTestConnection, input ?? {}),
    probeSqlDatabases: (input: unknown) => invoke(IpcChannels.dbProbeSqlDatabases, input),
    probeSqlSchemas: (input: unknown) => invoke(IpcChannels.dbProbeSqlSchemas, input),
    listContainers: () => invoke(IpcChannels.dbListContainers, undefined),
    executeSql: (input: unknown) => invoke(IpcChannels.dbExecuteSql, input),
    sampleTable: (input: unknown) => invoke(IpcChannels.dbSampleTable, input),
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
  visuals: {
    generate: (input: unknown) => invoke(IpcChannels.visualsGenerate, input),
  },
  streams: {
    sqlStart: (input: unknown) => invoke(IpcChannels.sqlStreamStart, input),
    executeStart: (input: unknown) => invoke(IpcChannels.executeStreamStart, input),
    cancel: (runId: string) => invoke(IpcChannels.streamCancel, { runId }),
    subscribe: (
      runId: string,
      handlers: {
        onBatch?: (evt: unknown) => void;
        onDone?: (evt: unknown) => void;
        onError?: (evt: unknown) => void;
      },
    ) => {
      const batchChan = StreamEventChannels.batch(runId);
      const doneChan = StreamEventChannels.done(runId);
      const errorChan = StreamEventChannels.error(runId);
      const batchListener = (_e: IpcRendererEvent, evt: unknown) => handlers.onBatch?.(evt);
      const doneListener = (_e: IpcRendererEvent, evt: unknown) => handlers.onDone?.(evt);
      const errorListener = (_e: IpcRendererEvent, evt: unknown) => handlers.onError?.(evt);
      ipcRenderer.on(batchChan, batchListener);
      ipcRenderer.on(doneChan, doneListener);
      ipcRenderer.on(errorChan, errorListener);
      return () => {
        ipcRenderer.off(batchChan, batchListener);
        ipcRenderer.off(doneChan, doneListener);
        ipcRenderer.off(errorChan, errorListener);
      };
    },
  },
  export: {
    start: (input: unknown) => invoke(IpcChannels.exportStart, input),
    cancel: (runId: string) => invoke(IpcChannels.exportCancel, { runId }),
    subscribe: (
      runId: string,
      handlers: {
        onProgress?: (evt: unknown) => void;
        onDone?: (evt: unknown) => void;
        onError?: (evt: unknown) => void;
      },
    ) => {
      const progressChan = StreamEventChannels.exportProgress(runId);
      const doneChan = StreamEventChannels.exportDone(runId);
      const errorChan = StreamEventChannels.exportError(runId);
      const progressListener = (_e: IpcRendererEvent, evt: unknown) =>
        handlers.onProgress?.(evt);
      const doneListener = (_e: IpcRendererEvent, evt: unknown) => handlers.onDone?.(evt);
      const errorListener = (_e: IpcRendererEvent, evt: unknown) => handlers.onError?.(evt);
      ipcRenderer.on(progressChan, progressListener);
      ipcRenderer.on(doneChan, doneListener);
      ipcRenderer.on(errorChan, errorListener);
      return () => {
        ipcRenderer.off(progressChan, progressListener);
        ipcRenderer.off(doneChan, doneListener);
        ipcRenderer.off(errorChan, errorListener);
      };
    },
  },
  dialog: {
    // Resolve an absolute filesystem path for a File obtained from a drag-drop
    // or <input type="file">. Replaces the legacy `file.path` property which
    // is not exposed under contextIsolation.
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    pickServiceAccount: () => invoke(IpcChannels.dialogPickServiceAccount, undefined),
    validateServiceAccount: (input: unknown) =>
      invoke(IpcChannels.dialogValidateServiceAccount, input),
    importServiceAccount: (input: unknown) =>
      invoke(IpcChannels.dialogImportServiceAccount, input),
    pickDataFile: () => invoke(IpcChannels.dialogPickDataFile, undefined),
  },
  menu: {
    /**
     * Subscribe to native-menu events emitted from `src/main/menu.ts`.
     * The returned disposer tears down the listener on unmount.
     */
    onCommand: (cb: (command: string, arg?: unknown) => void) => {
      const channels = [
        'menu:newProfile',
        'menu:navigate',
        'menu:clearHistory',
        'menu:checkForUpdates',
      ];
      const listeners = channels.map((ch) => {
        const fn = (_e: IpcRendererEvent, arg?: unknown) => cb(ch, arg);
        ipcRenderer.on(ch, fn);
        return { ch, fn };
      });
      return () => {
        for (const { ch, fn } of listeners) ipcRenderer.off(ch, fn);
      };
    },
  },
  updater: {
    /** Fire-and-forget: ask the main process to run an update check now. */
    checkNow: () => ipcRenderer.send('updater:checkNow'),
    /** Quit the app and install the already-downloaded update. */
    installNow: () => ipcRenderer.send('updater:installNow'),
    /** Subscribe to updater lifecycle events. Returns a disposer. */
    onEvent: (
      cb: (event: string, payload?: unknown) => void,
    ) => {
      const channels = [
        'updater:checking',
        'updater:available',
        'updater:none',
        'updater:progress',
        'updater:downloaded',
        'updater:error',
      ];
      const listeners = channels.map((ch) => {
        const fn = (_e: IpcRendererEvent, payload?: unknown) => cb(ch, payload);
        ipcRenderer.on(ch, fn);
        return { ch, fn };
      });
      return () => {
        for (const { ch, fn } of listeners) ipcRenderer.off(ch, fn);
      };
    },
  },
} as const;

contextBridge.exposeInMainWorld('fqs', api);

export type FqsApi = typeof api;
