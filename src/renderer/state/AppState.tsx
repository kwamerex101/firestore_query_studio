import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  Profile,
  LlmSettings,
  CursorSettings,
  LlmProvider,
} from '@shared/types/profile';
import type {
  CursorGetResult,
  CursorListModelsResult,
  CursorTestOutcome,
} from '@shared/types/ipc';
import type { HistoryEntry } from '@shared/types/history';
import { ipc } from '../lib/ipcClient';

interface AppStateValue {
  profiles: Profile[];
  activeProfile: Profile | null;
  llm: { baseUrl?: string; model?: string; timeoutMs?: number; hasApiKey: boolean } | null;
  cursor: CursorGetResult | null;
  provider: LlmProvider;
  loading: boolean;
  reloadProfiles(): Promise<void>;
  setActiveProfile(id: string | null): Promise<void>;
  reloadLlm(): Promise<void>;
  saveLlm(settings: LlmSettings): Promise<void>;
  reloadCursor(): Promise<void>;
  saveCursor(settings: CursorSettings): Promise<void>;
  reloadProvider(): Promise<void>;
  setProvider(next: LlmProvider): Promise<void>;
  listCursorModels(): Promise<CursorListModelsResult>;
  testCursor(settings?: CursorSettings): Promise<CursorTestOutcome>;
  /**
   * Cross-tab handoff for loading a history entry into the Query tab.
   * HistoryPage calls `loadHistoryEntry(entry)`; App switches to Query;
   * QueryPage observes and calls `clearPendingHistory()` once applied.
   */
  pendingHistory: HistoryEntry | null;
  loadHistoryEntry(entry: HistoryEntry): void;
  clearPendingHistory(): void;
  /**
   * Bumps when a new history entry is persisted (Firestore or SQL). History
   * tab subscribes to refetch without manual refresh.
   */
  historyEpoch: number;
  notifyHistoryChanged(): void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [llm, setLlm] = useState<AppStateValue['llm']>(null);
  const [cursor, setCursor] = useState<CursorGetResult | null>(null);
  const [provider, setProviderState] = useState<LlmProvider>('openai-compat');
  const [loading, setLoading] = useState(true);
  const [pendingHistory, setPendingHistory] = useState<HistoryEntry | null>(null);
  const [historyEpoch, setHistoryEpoch] = useState(0);

  const notifyHistoryChanged = useCallback(() => {
    setHistoryEpoch((n) => n + 1);
  }, []);

  const loadHistoryEntry = useCallback((entry: HistoryEntry) => {
    setPendingHistory(entry);
  }, []);

  const clearPendingHistory = useCallback(() => {
    setPendingHistory(null);
  }, []);

  const reloadProfiles = useCallback(async () => {
    const [list, active] = await Promise.all([
      ipc.profiles.list(),
      ipc.profiles.getActive(),
    ]);
    setProfiles(list);
    setActiveId(active.profileId);
  }, []);

  const reloadLlm = useCallback(async () => {
    const l = await ipc.llm.get();
    setLlm(l);
  }, []);

  const reloadCursor = useCallback(async () => {
    const c = await ipc.cursor.get();
    setCursor(c);
  }, []);

  const reloadProvider = useCallback(async () => {
    const res = await ipc.provider.get();
    setProviderState(res.provider);
  }, []);

  const setActiveProfile = useCallback(
    async (id: string | null) => {
      const res = await ipc.profiles.setActive({ profileId: id });
      setActiveId(res.profileId);
    },
    [],
  );

  const saveLlm = useCallback(async (settings: LlmSettings) => {
    const saved = await ipc.llm.set(settings);
    setLlm(saved);
  }, []);

  const saveCursor = useCallback(async (settings: CursorSettings) => {
    const saved = await ipc.cursor.set(settings);
    setCursor(saved);
  }, []);

  const setProvider = useCallback(async (next: LlmProvider) => {
    const res = await ipc.provider.set({ provider: next });
    setProviderState(res.provider);
  }, []);

  const listCursorModels = useCallback(async () => {
    return ipc.cursor.listModels();
  }, []);

  const testCursor = useCallback(async (settings?: CursorSettings) => {
    return ipc.cursor.test(settings);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([
          reloadProfiles(),
          reloadLlm(),
          reloadCursor(),
          reloadProvider(),
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadProfiles, reloadLlm, reloadCursor, reloadProvider]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeId) ?? null,
    [profiles, activeId],
  );

  const value = useMemo<AppStateValue>(
    () => ({
      profiles,
      activeProfile,
      llm,
      cursor,
      provider,
      loading,
      reloadProfiles,
      setActiveProfile,
      reloadLlm,
      saveLlm,
      reloadCursor,
      saveCursor,
      reloadProvider,
      setProvider,
      listCursorModels,
      testCursor,
      pendingHistory,
      loadHistoryEntry,
      clearPendingHistory,
      historyEpoch,
      notifyHistoryChanged,
    }),
    [
      profiles,
      activeProfile,
      llm,
      cursor,
      provider,
      loading,
      reloadProfiles,
      setActiveProfile,
      reloadLlm,
      saveLlm,
      reloadCursor,
      saveCursor,
      reloadProvider,
      setProvider,
      listCursorModels,
      testCursor,
      pendingHistory,
      loadHistoryEntry,
      clearPendingHistory,
      historyEpoch,
      notifyHistoryChanged,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
