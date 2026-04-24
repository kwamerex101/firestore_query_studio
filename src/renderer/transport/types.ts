import type {
  IpcApi,
  IpcChannel,
  IpcRequest,
  IpcResponse,
} from '@shared/ipc-api';
import { IpcChannels } from '@shared/types/ipc';

/**
 * The canonical shape exposed to the renderer. It mirrors the IPC surface
 * 1:1 (see [src/shared/ipc-api.ts](src/shared/ipc-api.ts)) but is transport
 * agnostic — `ElectronTransport` wraps `ipcRenderer.invoke`, `WebTransport`
 * calls browser-native implementations directly.
 *
 * When adding a new IPC channel, extend this type and both transports so
 * the renderer stays oblivious to which shell it's running in.
 */
export type FqsApi = {
  /**
   * Electron preload only: `ipcRenderer.invoke` under a stable name. The
   * transport uses this to reattach `db.probeSqlDatabases` /
   * `db.probeSqlSchemas` when the renderer hot-reloads but the preload
   * bundle (and thus `window.fqs.db`) is stale.
   */
  ipcInvoke?(channel: string, payload?: unknown): Promise<unknown>;
  profiles: {
    list(): Promise<IpcResponse<typeof IpcChannels.profilesList>>;
    create(
      req: IpcRequest<typeof IpcChannels.profilesCreate>,
    ): Promise<IpcResponse<typeof IpcChannels.profilesCreate>>;
    update(
      req: IpcRequest<typeof IpcChannels.profilesUpdate>,
    ): Promise<IpcResponse<typeof IpcChannels.profilesUpdate>>;
    delete(
      req: IpcRequest<typeof IpcChannels.profilesDelete>,
    ): Promise<IpcResponse<typeof IpcChannels.profilesDelete>>;
    setActive(
      req: IpcRequest<typeof IpcChannels.profilesSetActive>,
    ): Promise<IpcResponse<typeof IpcChannels.profilesSetActive>>;
    getActive(): Promise<IpcResponse<typeof IpcChannels.profilesGetActive>>;
  };
  llm: {
    get(): Promise<IpcResponse<typeof IpcChannels.llmGet>>;
    set(
      req: IpcRequest<typeof IpcChannels.llmSet>,
    ): Promise<IpcResponse<typeof IpcChannels.llmSet>>;
    warmup(): Promise<IpcResponse<typeof IpcChannels.llmWarmup>>;
  };
  cursor: {
    get(): Promise<IpcResponse<typeof IpcChannels.cursorGet>>;
    set(
      req: IpcRequest<typeof IpcChannels.cursorSet>,
    ): Promise<IpcResponse<typeof IpcChannels.cursorSet>>;
    listModels(): Promise<IpcResponse<typeof IpcChannels.cursorListModels>>;
    test(
      req?: IpcRequest<typeof IpcChannels.cursorTest>,
    ): Promise<IpcResponse<typeof IpcChannels.cursorTest>>;
  };
  provider: {
    get(): Promise<IpcResponse<typeof IpcChannels.providerGet>>;
    set(
      req: IpcRequest<typeof IpcChannels.providerSet>,
    ): Promise<IpcResponse<typeof IpcChannels.providerSet>>;
  };
  schema: {
    sample(
      req: IpcRequest<typeof IpcChannels.schemaSample>,
    ): Promise<IpcResponse<typeof IpcChannels.schemaSample>>;
    get(
      req: IpcRequest<typeof IpcChannels.schemaGet>,
    ): Promise<IpcResponse<typeof IpcChannels.schemaGet>>;
    saveOverride(
      req: IpcRequest<typeof IpcChannels.schemaSaveOverride>,
    ): Promise<IpcResponse<typeof IpcChannels.schemaSaveOverride>>;
  };
  plan: {
    build(
      req: IpcRequest<typeof IpcChannels.planBuild>,
    ): Promise<IpcResponse<typeof IpcChannels.planBuild>>;
    buildSql(
      req: IpcRequest<typeof IpcChannels.planBuildSql>,
    ): Promise<IpcResponse<typeof IpcChannels.planBuildSql>>;
  };
  execute: {
    run(
      req: IpcRequest<typeof IpcChannels.executeRun>,
    ): Promise<IpcResponse<typeof IpcChannels.executeRun>>;
  };
  collections: {
    list(): Promise<IpcResponse<typeof IpcChannels.collectionsList>>;
  };
  db: {
    testConnection(
      req?: IpcRequest<typeof IpcChannels.dbTestConnection>,
    ): Promise<IpcResponse<typeof IpcChannels.dbTestConnection>>;
    probeSqlDatabases(
      req: IpcRequest<typeof IpcChannels.dbProbeSqlDatabases>,
    ): Promise<IpcResponse<typeof IpcChannels.dbProbeSqlDatabases>>;
    probeSqlSchemas(
      req: IpcRequest<typeof IpcChannels.dbProbeSqlSchemas>,
    ): Promise<IpcResponse<typeof IpcChannels.dbProbeSqlSchemas>>;
    listContainers(): Promise<IpcResponse<typeof IpcChannels.dbListContainers>>;
    executeSql(
      req: IpcRequest<typeof IpcChannels.dbExecuteSql>,
    ): Promise<IpcResponse<typeof IpcChannels.dbExecuteSql>>;
    sampleTable(
      req: IpcRequest<typeof IpcChannels.dbSampleTable>,
    ): Promise<IpcResponse<typeof IpcChannels.dbSampleTable>>;
  };
  history: {
    list(
      req?: IpcRequest<typeof IpcChannels.historyList>,
    ): Promise<IpcResponse<typeof IpcChannels.historyList>>;
    get(
      req: IpcRequest<typeof IpcChannels.historyGet>,
    ): Promise<IpcResponse<typeof IpcChannels.historyGet>>;
    add(
      req: IpcRequest<typeof IpcChannels.historyAdd>,
    ): Promise<IpcResponse<typeof IpcChannels.historyAdd>>;
    clear(): Promise<IpcResponse<typeof IpcChannels.historyClear>>;
    findCached(
      req: IpcRequest<typeof IpcChannels.historyFindCached>,
    ): Promise<IpcResponse<typeof IpcChannels.historyFindCached>>;
  };
  insights: {
    generate(
      req: IpcRequest<typeof IpcChannels.insightsGenerate>,
    ): Promise<IpcResponse<typeof IpcChannels.insightsGenerate>>;
  };
  visuals: {
    generate(
      req: IpcRequest<typeof IpcChannels.visualsGenerate>,
    ): Promise<IpcResponse<typeof IpcChannels.visualsGenerate>>;
  };
  streams: {
    sqlStart(
      req: IpcRequest<typeof IpcChannels.sqlStreamStart>,
    ): Promise<IpcResponse<typeof IpcChannels.sqlStreamStart>>;
    executeStart(
      req: IpcRequest<typeof IpcChannels.executeStreamStart>,
    ): Promise<IpcResponse<typeof IpcChannels.executeStreamStart>>;
    cancel(runId: string): Promise<IpcResponse<typeof IpcChannels.streamCancel>>;
    subscribe(
      runId: string,
      handlers: {
        onBatch?: (evt: unknown) => void;
        onDone?: (evt: unknown) => void;
        onError?: (evt: unknown) => void;
      },
    ): () => void;
  };
  export: {
    start(
      req: IpcRequest<typeof IpcChannels.exportStart>,
    ): Promise<IpcResponse<typeof IpcChannels.exportStart>>;
    cancel(runId: string): Promise<IpcResponse<typeof IpcChannels.exportCancel>>;
    subscribe(
      runId: string,
      handlers: {
        onProgress?: (evt: unknown) => void;
        onDone?: (evt: unknown) => void;
        onError?: (evt: unknown) => void;
      },
    ): () => void;
  };
  dialog: {
    /**
     * Electron-only: resolve an absolute filesystem path for a DOM `File`.
     * The web transport returns `null` because the browser sandbox forbids
     * exposing real paths; callers must fall back to reading the file
     * contents in-memory instead.
     */
    getPathForFile(file: File): string | null;
    pickServiceAccount(): Promise<
      IpcResponse<typeof IpcChannels.dialogPickServiceAccount>
    >;
    validateServiceAccount(
      req: IpcRequest<typeof IpcChannels.dialogValidateServiceAccount>,
    ): Promise<IpcResponse<typeof IpcChannels.dialogValidateServiceAccount>>;
    importServiceAccount(
      req: IpcRequest<typeof IpcChannels.dialogImportServiceAccount>,
    ): Promise<IpcResponse<typeof IpcChannels.dialogImportServiceAccount>>;
  };
};

/**
 * Runtime flags each transport exposes. The renderer uses these to hide
 * features that don't apply (e.g. Postgres profiles on web).
 */
export interface TransportCapabilities {
  /** "electron" (full Admin SDK + keychain + Cursor CLI + pg) or "web" (browser, BYOK, Firebase Web SDK). */
  readonly shell: 'electron' | 'web';
  /** Desktop supports Postgres via the `pg` driver; web cannot. */
  readonly postgresProfiles: boolean;
  /** Desktop supports MySQL via `mysql2`; web cannot (no browser TCP). */
  readonly mysqlProfiles: boolean;
  /** Desktop supports SQL Server via the `mssql` package; web cannot. */
  readonly mssqlProfiles: boolean;
  /** Desktop supports Google BigQuery via `@google-cloud/bigquery`; web cannot. */
  readonly bigQueryProfiles: boolean;
  /** Desktop supports Cursor CLI as a planner backend; web cannot. */
  readonly cursorCli: boolean;
  /** Web uses IndexedDB with a device-scoped key, which is weaker than the OS keychain. */
  readonly keychainStorage: 'os' | 'indexeddb';
}

/**
 * Firebase Web config a user pastes into a profile on the web build. All of
 * these are public by design — Firebase apps enforce access via Security
 * Rules + Auth, not by hiding the API key.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
  messagingSenderId?: string;
  storageBucket?: string;
  databaseURL?: string;
}

export interface AuthUserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  providerId: string;
}

/**
 * Shell extensions only available on the web build. The Electron transport
 * returns `undefined` for these; UI code must feature-detect via
 * `transport.web` / `capabilities.shell === 'web'` before calling.
 */
export interface WebExtensions {
  /** Per-profile Firebase Web config (public, safe for IndexedDB). */
  firebaseConfig: {
    get(profileId: string): Promise<FirebaseWebConfig | null>;
    set(profileId: string, config: FirebaseWebConfig | null): Promise<void>;
  };
  /** Firebase Auth, scoped to the currently active profile. */
  auth: {
    getState(): Promise<AuthUserProfile | null>;
    signInWithGoogle(): Promise<AuthUserProfile>;
    signOut(): Promise<void>;
    subscribe(cb: (user: AuthUserProfile | null) => void): () => void;
  };
}

export interface Transport {
  readonly api: FqsApi;
  readonly capabilities: TransportCapabilities;
  readonly web?: WebExtensions;
}

export type { IpcApi, IpcChannel };
