import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Database, Settings, Search, History } from 'lucide-react';
import { useAppState } from '../state/AppState';
import { ProfilesPage } from './ProfilesPage';
import { QueryPage } from './QueryPage';
import { SettingsPage } from './SettingsPage';
import { HistoryPage } from './HistoryPage';
import { EnvBadge, EngineBadge } from '../components/ui/badge';
import { WebAuthBanner } from '../components/WebAuthBanner';
import { cn } from '../lib/utils';

type Tab = 'query' | 'history' | 'profiles' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'query', label: 'Query', icon: <Search size={14} /> },
  { id: 'history', label: 'History', icon: <History size={14} /> },
  { id: 'profiles', label: 'Profiles', icon: <Database size={14} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={14} /> },
];

export function App() {
  const { loading, pendingHistory } = useAppState();
  const [tab, setTab] = useState<Tab>('query');

  // When another tab hands off a history entry to the Query tab,
  // switch to Query so the user can see the restored state.
  useEffect(() => {
    if (pendingHistory) setTab('query');
  }, [pendingHistory]);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <div className="flex h-screen flex-col [padding-top:env(safe-area-inset-top)]">
      <header className="relative flex items-center justify-between border-b border-border bg-card/70 px-3 py-2 backdrop-blur-md sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="group relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-glow-primary transition-transform duration-300 hover:scale-105 hover:rotate-[-4deg]"
            aria-hidden
          >
            <Database size={14} />
          </span>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-semibold tracking-tight">
              Firestore Query Studio
            </span>
            <span className="hidden text-[11px] text-muted-foreground md:inline">
              Phase 1 MVP · read-only
            </span>
          </div>
        </div>

        {/* Desktop/tablet nav — hidden on xs so the header stays compact. */}
        <div className="hidden md:block">
          <AnimatedTabs active={tab} onChange={setTab} />
        </div>

        {/* bottom accent line */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
        />
      </header>

      <EnvStrip />
      <WebAuthBanner />

      <main className="relative flex-1 overflow-hidden">
        {/*
          Keep every tab mounted so that in-flight requests (e.g. "Building…"
          in QueryPage) and transient UI state like the NL question textarea
          survive tab switches. Only the active tab is visible.
        */}
        <TabPanel active={tab === 'query'}>
          <QueryPage />
        </TabPanel>
        <TabPanel active={tab === 'history'}>
          <HistoryPage onRequestSwitchToQuery={() => setTab('query')} />
        </TabPanel>
        <TabPanel active={tab === 'profiles'}>
          <ProfilesPage />
        </TabPanel>
        <TabPanel active={tab === 'settings'}>
          <SettingsPage />
        </TabPanel>
      </main>

      {/* Mobile bottom tab bar. Hidden from md up since the header already has
          the horizontal tabs. `env(safe-area-inset-bottom)` handles iOS home
          indicator / Android gesture bars on PWAs. */}
      <nav
        className="relative flex shrink-0 items-stretch justify-around border-t border-border bg-card/95 backdrop-blur-md md:hidden [padding-bottom:env(safe-area-inset-bottom)]"
        role="tablist"
        aria-label="Primary navigation"
      >
        {TABS.map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex min-h-[48px] min-w-[48px] flex-1 flex-col items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="flex items-center justify-center">{t.icon}</span>
              <span className="leading-none">{t.label}</span>
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute top-0 h-0.5 w-10 rounded-b bg-primary"
                />
              ) : null}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function TabPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'h-full',
        active ? 'block animate-fade-in' : 'hidden',
      )}
    >
      {children}
    </div>
  );
}

function EnvStrip() {
  const { activeProfile } = useAppState();

  if (!activeProfile) {
    return (
      <div className="border-b border-border bg-secondary/60 px-4 py-1.5 text-xs text-muted-foreground animate-fade-in">
        No active profile. Add one from the Profiles tab.
      </div>
    );
  }

  const tone =
    activeProfile.envTag === 'prod'
      ? 'border-env-prod/40 bg-env-prod/10 text-env-prod'
      : activeProfile.envTag === 'staging'
      ? 'border-env-staging/40 bg-env-staging/10 text-env-staging'
      : 'border-env-dev/40 bg-env-dev/10 text-env-dev';

  return (
    <div
      key={activeProfile.id}
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5 text-xs animate-fade-in-down sm:px-4',
        tone,
      )}
    >
      <EnvBadge envTag={activeProfile.envTag} />
      <EngineBadge engine={activeProfile.engine} />
      <span className="font-medium">{activeProfile.name}</span>
      {activeProfile.engine === 'postgres' ? (
        <>
          <span className="text-muted-foreground">
            · <span className="font-mono">{activeProfile.user}@{activeProfile.host}:{activeProfile.port}/{activeProfile.database}</span>
          </span>
          <span className="text-muted-foreground">· schema {activeProfile.schema}</span>
        </>
      ) : activeProfile.engine === 'mysql' ? (
        <span className="text-muted-foreground">
          · <span className="font-mono">{activeProfile.user}@{activeProfile.host}:{activeProfile.port}/{activeProfile.database}</span>
        </span>
      ) : activeProfile.engine === 'mssql' ? (
        <span className="text-muted-foreground">
          ·{' '}
          <span className="font-mono">
            {activeProfile.user}@{activeProfile.host}
            {activeProfile.instanceName ? `\\${activeProfile.instanceName}` : `:${activeProfile.port}`}
            /{activeProfile.database}
          </span>
        </span>
      ) : (
        <>
          <span className="text-muted-foreground">· {activeProfile.projectId}</span>
          <span className="text-muted-foreground">
            ·{' '}
            {activeProfile.kind === 'emulator'
              ? `emulator @ ${activeProfile.host}:${activeProfile.port}`
              : 'live (Admin SDK)'}
          </span>
        </>
      )}
    </div>
  );
}

function AnimatedTabs({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLButtonElement>(`[data-tab="${active}"]`);
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    setIndicator({ left: rect.left - containerRect.left, width: rect.width });
  }, [active]);

  return (
    <nav
      ref={containerRef}
      className="relative flex items-center gap-0.5 rounded-md border border-border/60 bg-secondary/40 p-0.5"
      role="tablist"
      aria-label="Primary navigation"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-[5px] bg-primary/20 shadow-soft transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]"
        style={{
          transform: `translateX(${indicator.left}px)`,
          width: indicator.width ? `${indicator.width}px` : 0,
          opacity: indicator.width ? 1 : 0,
        }}
      />
      {TABS.map((t) => (
        <button
          key={t.id}
          data-tab={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'relative z-10 flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors duration-200',
            active === t.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 text-sm text-muted-foreground">
      <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-glow-primary">
        <Database size={20} />
        <span
          aria-hidden
          className="absolute inset-0 rounded-xl ring-2 ring-primary/40 animate-ping-soft"
        />
      </div>
      <span className="animate-pulse">Loading workspace…</span>
    </div>
  );
}
