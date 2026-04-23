import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  History as HistoryIcon,
  Trash2,
  RefreshCw,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  FileText,
  Search,
  Database,
  Flame,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { HistoryEntry, HistorySummary, SqlHistoryEntry } from '@shared/types/history';
import { isSqlHistoryEntry } from '@shared/types/history';
import type { Engine, Profile } from '@shared/types/profile';
import {
  isFirestoreProfile,
  isMssqlProfile,
  isMysqlProfile,
  isPostgresProfile,
} from '@shared/types/profile';
import { useAppState } from '../state/AppState';
import { ipc } from '../lib/ipcClient';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog } from '../components/ui/dialog';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/utils';

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function groupByDay(entries: HistorySummary[]): Array<{ label: string; items: HistorySummary[] }> {
  const groups = new Map<string, HistorySummary[]>();
  for (const e of entries) {
    const d = new Date(e.createdAt);
    const key = d.toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  const today = new Date().toDateString();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toDateString();
  return Array.from(groups.entries()).map(([key, items]) => ({
    label: key === today ? 'Today' : key === yesterday ? 'Yesterday' : key,
    items,
  }));
}

export function HistoryPage({ onRequestSwitchToQuery }: { onRequestSwitchToQuery: () => void }) {
  const { activeProfile, loadHistoryEntry } = useAppState();
  const toast = useToast();
  const [entries, setEntries] = useState<HistorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<HistoryEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const reload = useCallback(async () => {
    if (!activeProfile) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const res = await ipc.history.list({});
      setEntries(res.entries);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [activeProfile, toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.question.toLowerCase().includes(q) ||
        (e.collection ?? '').toLowerCase().includes(q) ||
        (e.sqlPreview ?? '').toLowerCase().includes(q),
    );
  }, [entries, search]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    try {
      const res = await ipc.history.get({ id });
      if (!res.entry) {
        toast.push('Entry not found. It may have been cleared.', 'error');
        return;
      }
      setDetail(res.entry);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setDetailLoading(false);
    }
  }

  function loadIntoQuery(entry: HistoryEntry) {
    loadHistoryEntry(entry);
    setDetail(null);
    onRequestSwitchToQuery();
  }

  async function clearAll() {
    try {
      const res = await ipc.history.clear();
      toast.push(`Cleared ${res.cleared} history ${res.cleared === 1 ? 'entry' : 'entries'}.`, 'success');
      setConfirmClear(false);
      await reload();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  if (!activeProfile) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground animate-fade-in">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary/60 text-primary">
            <FileText size={22} />
          </div>
          <div className="text-balance">
            Select a profile from the <b>Profiles</b> tab to view its history.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <HistoryIcon size={14} className="text-primary" />
        <span className="text-sm font-semibold">Query history</span>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          · {entries.length} {entries.length === 1 ? 'entry' : 'entries'} for{' '}
          <span className="font-medium text-foreground/80">{activeProfile.name}</span>
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={11}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter…"
              className="h-7 w-full pl-6 text-xs sm:w-56"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={reload}
            loading={loading}
            title="Refresh"
            aria-label="Refresh history"
          >
            <RefreshCw size={12} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmClear(true)}
            disabled={entries.length === 0}
            title="Clear all history"
          >
            <Trash2 size={12} />
            Clear
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {entries.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No entries match &ldquo;{search}&rdquo;.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 border-b border-border bg-card/80 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    profile={activeProfile}
                    onOpen={() => openDetail(item.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `Asked ${formatRelative(detail.createdAt)}` : 'Loading…'}
        description={detail ? formatAbsolute(detail.createdAt) : undefined}
        className="max-w-4xl"
        footer={
          detail ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setDetail(null)}>
                Close
              </Button>
              <Button variant="primary" onClick={() => loadIntoQuery(detail)}>
                <ArrowUpRight size={12} />
                Load in Query
              </Button>
            </div>
          ) : null
        }
      >
        {detailLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : detail ? (
          <HistoryDetail entry={detail} />
        ) : null}
      </Dialog>

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear all history?"
        description="This deletes every saved question and answer for the current profile. It cannot be undone."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={clearAll}>
              <Trash2 size={12} />
              Clear {entries.length}
            </Button>
          </div>
        }
      >
        <div className="text-sm text-muted-foreground">
          Only history is cleared. Profiles, schema caches, and LLM settings are untouched.
        </div>
      </Dialog>
    </div>
  );
}

function HistoryRow({
  item,
  profile,
  onOpen,
}: {
  item: HistorySummary;
  profile: Profile | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/50',
      )}
    >
      <div className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-secondary/60">
        {item.ok ? (
          <CheckCircle2 size={14} className="text-env-dev" />
        ) : (
          <XCircle size={14} className="text-destructive" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-foreground">{item.question}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{formatRelative(item.createdAt)}</span>
          {profile ? (
            <>
              <span>·</span>
              <DatabaseChip profile={profile} />
            </>
          ) : null}
          {item.mode === 'sql' && item.sqlPreview ? (
            <>
              <span>·</span>
              <span className="max-w-[200px] truncate font-mono" title={item.sqlPreview}>
                {item.sqlPreview}
              </span>
            </>
          ) : null}
          {item.collection ? (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Database size={10} />
                {item.collection}
              </span>
            </>
          ) : null}
          <span>·</span>
          <span className="uppercase tracking-wide">{item.mode}</span>
          <span>·</span>
          <span>
            {item.rowsReturned} {item.rowsReturned === 1 ? 'row' : 'rows'}
          </span>
          <span>·</span>
          <span>{formatDuration(item.durationMs)}</span>
        </div>
      </div>
      <ArrowUpRight
        size={14}
        className="flex-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

const envChipClass: Record<Profile['envTag'], string> = {
  dev: 'border-env-dev/40 bg-env-dev/10 text-env-dev',
  staging: 'border-env-staging/40 bg-env-staging/10 text-env-staging',
  prod: 'border-env-prod/40 bg-env-prod/10 text-env-prod',
};

/**
 * Per-engine presentation metadata for the history tile chip.
 * Add new engines (mysql, mssql, oracle, …) by extending this lookup and
 * `getDatabaseName` / `getDatabaseTitle` below — the rest of the chip is
 * engine-agnostic.
 */
const engineMeta: Record<Engine, { label: string; icon: LucideIcon }> = {
  firestore: { label: 'Firestore', icon: Flame },
  postgres: { label: 'Postgres', icon: Database },
  mysql: { label: 'MySQL', icon: Database },
  mssql: { label: 'SQL Server', icon: Database },
};

function getDatabaseName(profile: Profile): string {
  if (isFirestoreProfile(profile)) return profile.projectId;
  if (isPostgresProfile(profile)) return profile.database;
  if (isMysqlProfile(profile)) return profile.database;
  if (isMssqlProfile(profile)) return profile.database;
  // Exhaustiveness guard — adding a new engine variant will fail here.
  const _exhaustive: never = profile;
  return (_exhaustive as { name?: string }).name ?? '';
}

function getDatabaseTitle(profile: Profile): string {
  const meta = engineMeta[profile.engine];
  if (isFirestoreProfile(profile)) {
    const where =
      profile.kind === 'emulator' ? `emulator @ ${profile.host}:${profile.port}` : 'live';
    return `${meta.label} · ${profile.projectId} (${where})`;
  }
  if (isPostgresProfile(profile) || isMysqlProfile(profile)) {
    return `${meta.label} · ${profile.user}@${profile.host}:${profile.port}/${profile.database}`;
  }
  if (isMssqlProfile(profile)) {
    const hostPart = profile.instanceName
      ? `${profile.host}\\${profile.instanceName}`
      : `${profile.host}:${profile.port}`;
    return `${meta.label} · ${profile.user}@${hostPart}/${profile.database}`;
  }
  return meta.label;
}

function DatabaseChip({ profile }: { profile: Profile }) {
  const meta = engineMeta[profile.engine];
  const Icon = meta.icon;
  const name = getDatabaseName(profile);
  // Firestore-specific: surface "emulator" at a glance since the same project
  // id can be targeted by both live and emulator profiles.
  const isEmulator = isFirestoreProfile(profile) && profile.kind === 'emulator';
  return (
    <span
      className={cn('badge normal-case tracking-normal', envChipClass[profile.envTag])}
      title={getDatabaseTitle(profile)}
    >
      <Icon size={10} />
      <span className="font-semibold uppercase tracking-wide">{meta.label}</span>
      <span className="opacity-50">·</span>
      <span className="max-w-[140px] truncate font-medium">{name}</span>
      {isEmulator ? (
        <span className="ml-0.5 text-[9px] font-semibold uppercase tracking-wider opacity-70">
          · emu
        </span>
      ) : null}
    </span>
  );
}

function HistoryDetail({ entry }: { entry: HistoryEntry }) {
  const [tab, setTab] = useState<'rows' | 'plan'>('rows');
  if (isSqlHistoryEntry(entry)) {
    return <SqlHistoryDetail entry={entry} tab={tab} onTab={setTab} />;
  }
  const rowCount = entry.outcome.ok ? entry.outcome.rows.length : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Question</div>
        <div className="mt-0.5 whitespace-pre-wrap">{entry.question}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {entry.collection ? (
            <span className="inline-flex items-center gap-1">
              <Database size={10} />
              {entry.collection}
            </span>
          ) : (
            <span>(LLM-picked collection)</span>
          )}
          <span>mode · {entry.plan.mode}</span>
          {entry.outcome.ok ? (
            <>
              <span>{rowCount} {rowCount === 1 ? 'row' : 'rows'}</span>
              <span>{formatDuration(entry.outcome.stats.durationMs)}</span>
              <span>scanned {entry.outcome.stats.scanned}</span>
            </>
          ) : (
            <span className="text-destructive">{entry.outcome.code}</span>
          )}
          {entry.rowsTruncated ? (
            <span className="rounded bg-env-staging/20 px-1.5 py-0.5 text-env-staging">
              rows truncated in history
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border text-xs">
        {(['rows', 'plan'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'relative px-2 py-1.5 font-medium capitalize transition-colors',
              tab === t
                ? 'text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'rows' ? (
        entry.outcome.ok ? (
          entry.outcome.rows.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No rows returned.
            </div>
          ) : (
            <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-background/80 p-2 text-[11px] leading-relaxed">
              {JSON.stringify(entry.outcome.rows, null, 2)}
            </pre>
          )
        ) : (
          <div className="space-y-2">
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
              <div className="font-semibold text-destructive">{entry.outcome.code}</div>
              <div className="mt-1 whitespace-pre-wrap text-foreground/90">{entry.outcome.message}</div>
            </div>
            {entry.outcome.indexHint?.url ? (
              <a
                href={entry.outcome.indexHint.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 rounded-md border border-primary/60 bg-primary/20 px-2 py-1 text-xs text-primary hover:bg-primary/30"
              >
                Open index-creation link
              </a>
            ) : null}
          </div>
        )
      ) : (
        <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-background/80 p-2 text-[11px] leading-relaxed">
          {JSON.stringify(entry.plan, null, 2)}
        </pre>
      )}
    </div>
  );
}

function SqlHistoryDetail({
  entry,
  tab,
  onTab,
}: {
  entry: SqlHistoryEntry;
  tab: 'rows' | 'plan';
  onTab: (t: 'rows' | 'plan') => void;
}) {
  const rowCount = entry.outcome.ok ? entry.outcome.rows.length : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Question</div>
        <div className="mt-0.5 whitespace-pre-wrap">{entry.question}</div>
        <div className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">SQL</div>
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background/50 p-2 text-[11px] font-mono text-foreground/90">
          {entry.sqlPlan.sql}
        </pre>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            {entry.sqlPlan.dialect} · limit {entry.sqlPlan.limit}
          </span>
          {entry.outcome.ok ? (
            <>
              <span>
                {rowCount} {rowCount === 1 ? 'row' : 'rows'}
              </span>
              <span>{formatDuration(entry.outcome.elapsedMs)}</span>
            </>
          ) : (
            <span className="text-destructive">{entry.outcome.code}</span>
          )}
          {entry.rowsTruncated ? (
            <span className="rounded bg-env-staging/20 px-1.5 py-0.5 text-env-staging">
              rows truncated in history
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border text-xs">
        {(['rows', 'plan'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTab(t)}
            className={cn(
              'relative px-2 py-1.5 font-medium capitalize transition-colors',
              tab === t
                ? 'text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'plan' ? 'plan JSON' : t}
          </button>
        ))}
      </div>

      {tab === 'rows' ? (
        entry.outcome.ok ? (
          entry.outcome.rows.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No rows returned.
            </div>
          ) : (
            <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-background/80 p-2 text-[11px] leading-relaxed">
              {JSON.stringify(
                entry.outcome.rows.map((r, i) => ({ i, ...r })),
                null,
                2,
              )}
            </pre>
          )
        ) : (
          <div className="space-y-2">
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
              <div className="font-semibold text-destructive">{entry.outcome.code}</div>
              <div className="mt-1 whitespace-pre-wrap text-foreground/90">
                {entry.outcome.message}
              </div>
            </div>
            {entry.outcome.executedSql ? (
              <div>
                <div className="text-[10px] text-muted-foreground">Executed SQL</div>
                <pre className="mt-1 whitespace-pre-wrap rounded border border-border bg-background/50 p-2 text-[11px] font-mono">
                  {entry.outcome.executedSql}
                </pre>
              </div>
            ) : null}
          </div>
        )
      ) : (
        <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-background/80 p-2 text-[11px] leading-relaxed">
          {JSON.stringify(entry.sqlPlan, null, 2)}
        </pre>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary/60 text-primary">
        <HistoryIcon size={20} />
      </div>
      <div>
        No queries yet. Every question or SQL run for this profile is saved here.
      </div>
    </div>
  );
}
