import type { FqsApi, Transport, WebExtensions } from '../types';
import { capabilities } from './capabilities';
import {
  createProfile,
  deleteProfile,
  getActiveProfileResult,
  getFirebaseConfigFor,
  listProfiles,
  setActiveProfileId,
  setFirebaseConfigFor,
  updateProfile,
} from './profiles';
import { auth, invalidateAuthForActiveChange } from './auth';
import { invalidateProfile } from './firebase';
import {
  cursorGet,
  cursorSet,
  llmGet,
  llmSet,
  llmWarmup,
  providerGet,
  providerSet,
} from './settings';
import { schemaGet, schemaSample, schemaSaveOverride } from './schema';
import { runPlan } from './executor';
import {
  collectionsList,
  dbExecuteSql,
  dbListContainers,
  dbSampleTable,
  dbTestConnection,
  planBuildSql,
} from './collections';
import {
  historyAdd,
  historyClear,
  historyFindCached,
  historyGet,
  historyList,
} from './history';
import { insightsGenerate, planBuild } from './planner';
import { visualsGenerate } from './visuals';
import {
  exportCancel,
  exportStart,
  exportSubscribe,
  streamCancel,
  streamExecuteStart,
  streamSqlStart,
  streamSubscribe,
} from './streams';

/**
 * Single entry point for the web/PWA shell. This mirrors `FqsApi` 1:1 so the
 * shared UI can talk to either transport without knowing which one it got.
 *
 * Ground rules enforced here (see the individual modules for details):
 *   - Postgres profiles and the Cursor CLI provider are refused at the
 *     boundary. The UI already hides those affordances via
 *     `capabilities.postgresProfiles` / `capabilities.cursorCli`, but the
 *     shell double-checks so a stale build or imported profile can't
 *     bypass the feature flag.
 *   - Filesystem-style operations (pick/validate/import service account)
 *     return canceled/NOT_FOUND responses — the browser sandbox has no
 *     notion of absolute paths. Profiles are configured by pasting a
 *     Firebase Web config instead.
 */
const api: FqsApi = {
  profiles: {
    list: () => listProfiles(),
    create: (req) => createProfile(req),
    update: (req) => updateProfile(req.id, req.update),
    delete: async (req) => {
      await deleteProfile(req.id);
      return { ok: true };
    },
    setActive: async (req) => {
      const res = await setActiveProfileId(req);
      // Drop cached Firebase apps + auth listeners for the previous profile
      // so the next query uses fresh credentials. Fire-and-forget because
      // the renderer is already re-fetching active state by the time this
      // returns.
      void invalidateAuthForActiveChange();
      return res;
    },
    getActive: () => getActiveProfileResult(),
  },
  llm: {
    get: () => llmGet(),
    set: (req) => llmSet(req),
    warmup: () => llmWarmup(),
  },
  cursor: {
    get: () => cursorGet(),
    set: (req) => cursorSet(req),
    listModels: async () => ({ models: [], source: 'fallback' as const }),
    test: async () => ({
      ok: false,
      code: 'UNSUPPORTED',
      message:
        'The Cursor CLI provider is only available in the desktop app. Use an OpenAI-compatible endpoint in the web build.',
      elapsedMs: 0,
    }),
  },
  claude: {
    // The Claude CLI spawns a Node child process; browsers can't do that.
    // Returning a disabled stub keeps the provider switcher safe on web.
    get: async () => ({ isConfigured: false }),
    set: async () => {
      throw new Error(
        'Claude CLI is only available in the desktop app. Use an OpenAI-compatible endpoint in the web build.',
      );
    },
    listModels: async () => ({ models: [], source: 'fallback' as const }),
    test: async () => ({
      ok: false,
      code: 'UNSUPPORTED',
      message:
        'The Claude CLI provider is only available in the desktop app. Use an OpenAI-compatible endpoint in the web build.',
    }),
  },
  provider: {
    get: () => providerGet(),
    set: (req) => providerSet(req),
  },
  schema: {
    sample: (req) => schemaSample(req),
    get: (req) => schemaGet(req),
    saveOverride: (req) => schemaSaveOverride(req),
  },
  plan: {
    build: (req) => planBuild(req),
    buildSql: () => planBuildSql(),
  },
  execute: {
    run: (req) => runPlan(req.plan),
  },
  collections: {
    list: () => collectionsList(),
  },
  db: {
    testConnection: (req) => dbTestConnection(req),
    probeSqlDatabases: async () => ({
      ok: false,
      code: 'UNSUPPORTED_IN_WEB',
      message: 'SQL database discovery is only available in the desktop app.',
      elapsedMs: 0,
    }),
    probeSqlSchemas: async () => ({
      ok: false,
      code: 'UNSUPPORTED_IN_WEB',
      message: 'SQL schema discovery is only available in the desktop app.',
      elapsedMs: 0,
    }),
    listContainers: () => dbListContainers(),
    executeSql: () => dbExecuteSql(),
    sampleTable: () => dbSampleTable(),
  },
  history: {
    list: (req) => historyList(req),
    get: (req) => historyGet(req),
    add: (req) => historyAdd(req),
    clear: () => historyClear(),
    findCached: (req) => historyFindCached(req),
  },
  insights: {
    generate: (req) => insightsGenerate(req),
  },
  visuals: {
    generate: (req) => visualsGenerate(req),
  },
  streams: {
    sqlStart: (req) => streamSqlStart(req),
    executeStart: (req) => streamExecuteStart(req),
    cancel: (runId) => streamCancel(runId),
    subscribe: (runId, handlers) => streamSubscribe(runId, handlers),
  },
  export: {
    start: (req) => exportStart(req),
    cancel: (runId) => exportCancel(runId),
    subscribe: (runId, handlers) => exportSubscribe(runId, handlers),
  },
  dialog: {
    // Browsers don't expose real filesystem paths for `File` objects. The
    // Electron path is the only one that can resolve this meaningfully; on
    // web we return `null` and let the UI fall back to reading the File's
    // contents in memory.
    getPathForFile: () => null,
    pickServiceAccount: async () => ({ canceled: true }),
    validateServiceAccount: async (req) => ({
      ok: false,
      code: 'NOT_FOUND',
      path: req.path,
      message:
        'Browser builds cannot read files by path. Paste your Firebase Web config into the profile instead.',
    }),
    importServiceAccount: async () => {
      throw new Error(
        'Service account imports are only available in the desktop app. Use Firebase Web config + Firebase Auth in the browser.',
      );
    },
  },
};

const web: WebExtensions = {
  firebaseConfig: {
    get: (profileId) => getFirebaseConfigFor(profileId),
    set: async (profileId, config) => {
      await setFirebaseConfigFor(profileId, config);
      // Clear both the Firestore and Auth caches so the next call picks
      // up the new config without a page reload.
      invalidateProfile(profileId);
      await invalidateAuthForActiveChange();
    },
  },
  auth,
};

export const transport: Transport = {
  api,
  capabilities,
  web,
};

export type {
  AuthUserProfile,
  FirebaseWebConfig,
  FqsApi,
  Transport,
  TransportCapabilities,
  WebExtensions,
  IpcApi,
  IpcChannel,
} from '../types';
