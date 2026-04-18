import type {
  IpcApi,
  IpcChannel,
  IpcRequest,
  IpcResponse,
} from '@shared/ipc-api';
import { IpcChannels } from '@shared/types/ipc';

type Api = {
  profiles: {
    list(): Promise<IpcResponse<typeof IpcChannels.profilesList>>;
    create(req: IpcRequest<typeof IpcChannels.profilesCreate>): Promise<IpcResponse<typeof IpcChannels.profilesCreate>>;
    update(req: IpcRequest<typeof IpcChannels.profilesUpdate>): Promise<IpcResponse<typeof IpcChannels.profilesUpdate>>;
    delete(req: IpcRequest<typeof IpcChannels.profilesDelete>): Promise<IpcResponse<typeof IpcChannels.profilesDelete>>;
    setActive(req: IpcRequest<typeof IpcChannels.profilesSetActive>): Promise<IpcResponse<typeof IpcChannels.profilesSetActive>>;
    getActive(): Promise<IpcResponse<typeof IpcChannels.profilesGetActive>>;
  };
  llm: {
    get(): Promise<IpcResponse<typeof IpcChannels.llmGet>>;
    set(req: IpcRequest<typeof IpcChannels.llmSet>): Promise<IpcResponse<typeof IpcChannels.llmSet>>;
    warmup(): Promise<IpcResponse<typeof IpcChannels.llmWarmup>>;
  };
  cursor: {
    get(): Promise<IpcResponse<typeof IpcChannels.cursorGet>>;
    set(req: IpcRequest<typeof IpcChannels.cursorSet>): Promise<IpcResponse<typeof IpcChannels.cursorSet>>;
    listModels(): Promise<IpcResponse<typeof IpcChannels.cursorListModels>>;
    test(req?: IpcRequest<typeof IpcChannels.cursorTest>): Promise<IpcResponse<typeof IpcChannels.cursorTest>>;
  };
  provider: {
    get(): Promise<IpcResponse<typeof IpcChannels.providerGet>>;
    set(req: IpcRequest<typeof IpcChannels.providerSet>): Promise<IpcResponse<typeof IpcChannels.providerSet>>;
  };
  schema: {
    sample(req: IpcRequest<typeof IpcChannels.schemaSample>): Promise<IpcResponse<typeof IpcChannels.schemaSample>>;
    get(req: IpcRequest<typeof IpcChannels.schemaGet>): Promise<IpcResponse<typeof IpcChannels.schemaGet>>;
    saveOverride(req: IpcRequest<typeof IpcChannels.schemaSaveOverride>): Promise<IpcResponse<typeof IpcChannels.schemaSaveOverride>>;
  };
  plan: {
    build(req: IpcRequest<typeof IpcChannels.planBuild>): Promise<IpcResponse<typeof IpcChannels.planBuild>>;
  };
  execute: {
    run(req: IpcRequest<typeof IpcChannels.executeRun>): Promise<IpcResponse<typeof IpcChannels.executeRun>>;
  };
  collections: {
    list(): Promise<IpcResponse<typeof IpcChannels.collectionsList>>;
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
};

declare global {
  interface Window {
    fqs: Api;
  }
}

const STALE_PRELOAD_MESSAGE =
  'This renderer is connected to a stale preload bundle. Stop and restart `pnpm dev` — Electron has to re-run the preload script (contextBridge cannot hot-reload).';

function createMissingNamespaceProxy(name: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, method: string | symbol) {
        throw new Error(
          `window.fqs.${name}.${String(method)} is not available. ${STALE_PRELOAD_MESSAGE}`,
        );
      },
    },
  );
}

function resolveApi(): Api {
  const real = window.fqs as Partial<Api> | undefined;
  if (!real) {
    throw new Error(`window.fqs is undefined. ${STALE_PRELOAD_MESSAGE}`);
  }
  const expected: Array<keyof Api> = [
    'profiles',
    'llm',
    'cursor',
    'provider',
    'schema',
    'plan',
    'execute',
    'collections',
    'history',
    'insights',
  ];
  const patched: Record<string, unknown> = { ...real };
  for (const key of expected) {
    if (!patched[key]) {
      patched[key] = createMissingNamespaceProxy(key);
    }
  }
  return patched as Api;
}

export const ipc: Api = resolveApi();

export type { IpcApi, IpcChannel };
