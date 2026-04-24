import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'dark' | 'light' | 'system';

const THEME_KEY = 'fqs-theme';
const ONBOARDING_KEY = 'fqs-onboarding-done';

function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  } catch { /* ignore */ }
  return 'dark';
}
import type {
  Profile,
  LlmSettings,
  CursorSettings,
  ClaudeSettings,
  LlmProvider,
} from '@shared/types/profile';
import type {
  CursorGetResult,
  CursorListModelsResult,
  CursorTestOutcome,
  ClaudeGetResult,
  ClaudeListModelsResult,
  ClaudeTestOutcome,
} from '@shared/types/ipc';
import type { HistoryEntry } from '@shared/types/history';
import { ipc } from '../lib/ipcClient';

interface AppStateValue {
  theme: Theme;
  setTheme(t: Theme): void;
  profiles: Profile[];
  activeProfile: Profile | null;
  llm: { baseUrl?: string; model?: string; timeoutMs?: number; hasApiKey: boolean } | null;
  cursor: CursorGetResult | null;
  claude: ClaudeGetResult | null;
  provider: LlmProvider;
  loading: boolean;
  reloadProfiles(): Promise<void>;
  setActiveProfile(id: string | null): Promise<void>;
  reloadLlm(): Promise<void>;
  saveLlm(settings: LlmSettings): Promise<void>;
  reloadCursor(): Promise<void>;
  saveCursor(settings: CursorSettings): Promise<void>;
  reloadClaude(): Promise<void>;
  saveClaude(settings: ClaudeSettings): Promise<void>;
  reloadProvider(): Promise<void>;
  setProvider(next: LlmProvider): Promise<void>;
  listCursorModels(): Promise<CursorListModelsResult>;
  testCursor(settings?: CursorSettings): Promise<CursorTestOutcome>;
  listClaudeModels(): Promise<ClaudeListModelsResult>;
  testClaude(settings?: ClaudeSettings): Promise<ClaudeTestOutcome>;
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
  onboardingComplete: boolean;
  completeOnboarding(): void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [llm, setLlm] = useState<AppStateValue['llm']>(null);
  const [cursor, setCursor] = useState<CursorGetResult | null>(null);
  const [claude, setClaude] = useState<ClaudeGetResult | null>(null);
  const [provider, setProviderState] = useState<LlmProvider>('openai-compat');
  const [loading, setLoading] = useState(true);
  const [pendingHistory, setPendingHistory] = useState<HistoryEntry | null>(null);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [onboardingComplete, setOnboardingComplete] = useState(() => {
    try { return localStorage.getItem(ONBOARDING_KEY) === '1'; } catch { return false; }
  });

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
    applyTheme(t);
  }, []);

  // Apply theme on mount and watch system preference changes
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const notifyHistoryChanged = useCallback(() => {
    setHistoryEpoch((n) => n + 1);
  }, []);

  const loadHistoryEntry = useCallback((entry: HistoryEntry) => {
    setPendingHistory(entry);
  }, []);

  const clearPendingHistory = useCallback(() => {
    setPendingHistory(null);
  }, []);

  const completeOnboarding = useCallback(() => {
    try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch { /* ignore */ }
    setOnboardingComplete(true);
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

  const reloadClaude = useCallback(async () => {
    const c = await ipc.claude.get();
    setClaude(c);
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

  const saveClaude = useCallback(async (settings: ClaudeSettings) => {
    const saved = await ipc.claude.set(settings);
    setClaude(saved);
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

  const listClaudeModels = useCallback(async () => {
    return ipc.claude.listModels();
  }, []);

  const testClaude = useCallback(async (settings?: ClaudeSettings) => {
    return ipc.claude.test(settings);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([
          reloadProfiles(),
          reloadLlm(),
          reloadCursor(),
          reloadClaude(),
          reloadProvider(),
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadProfiles, reloadLlm, reloadCursor, reloadClaude, reloadProvider]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeId) ?? null,
    [profiles, activeId],
  );

  const value = useMemo<AppStateValue>(
    () => ({
      theme,
      setTheme,
      profiles,
      activeProfile,
      llm,
      cursor,
      claude,
      provider,
      loading,
      reloadProfiles,
      setActiveProfile,
      reloadLlm,
      saveLlm,
      reloadCursor,
      saveCursor,
      reloadClaude,
      saveClaude,
      reloadProvider,
      setProvider,
      listCursorModels,
      testCursor,
      listClaudeModels,
      testClaude,
      pendingHistory,
      loadHistoryEntry,
      clearPendingHistory,
      historyEpoch,
      notifyHistoryChanged,
      onboardingComplete,
      completeOnboarding,
    }),
    [
      theme,
      setTheme,
      profiles,
      activeProfile,
      llm,
      cursor,
      claude,
      provider,
      loading,
      reloadProfiles,
      setActiveProfile,
      reloadLlm,
      saveLlm,
      reloadCursor,
      saveCursor,
      reloadClaude,
      saveClaude,
      reloadProvider,
      setProvider,
      listCursorModels,
      testCursor,
      listClaudeModels,
      testClaude,
      pendingHistory,
      loadHistoryEntry,
      clearPendingHistory,
      historyEpoch,
      notifyHistoryChanged,
      onboardingComplete,
      completeOnboarding,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
