import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Play,
  Wand2,
  ExternalLink,
  RefreshCw,
  FileText,
  Sparkles,
  History as HistoryIcon,
} from 'lucide-react';
import type { QueryPlan } from '@shared/types/plan';
import type { CollectionSchema } from '@shared/types/schema';
import type { RunOutcome } from '@shared/types/results';
import type { HistoryEntry } from '@shared/types/history';
import { isFirestoreHistoryEntry } from '@shared/types/history';
import { useAppState } from '../state/AppState';
import { ipc } from '../lib/ipcClient';
import { Button } from '../components/ui/button';
import { Input, Textarea } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useToast } from '../components/ui/toast';
import { ResultsTable } from './ResultsTable';
import { ExplainPanel } from './ExplainPanel';
import { SchemaEditor } from './SchemaEditor';
import { InsightsPanel } from './InsightsPanel';
import { SqlQueryPanel } from './SqlQueryPanel';
import { isSqlProfile } from '@shared/types/profile';
import { cn } from '../lib/utils';

type RightTab = 'explain' | 'insights' | 'schema';

function normalizeCollection(c: string): string | undefined {
  const trimmed = c.trim();
  return trimmed.length ? trimmed : undefined;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function QueryPage() {
  const { activeProfile, llm, pendingHistory, clearPendingHistory } = useAppState();
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [collections, setCollections] = useState<string[]>([]);
  const [collection, setCollection] = useState<string>('');
  const [schema, setSchema] = useState<CollectionSchema | null>(null);
  const [plan, setPlan] = useState<QueryPlan | null>(null);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [building, setBuilding] = useState(false);
  const [running, setRunning] = useState(false);
  const [autoRun, setAutoRun] = useState(true);
  const [rightTab, setRightTab] = useState<RightTab>('explain');
  /**
   * Snapshot of (question, collection) at the time the CURRENT plan was
   * built. When the live inputs drift from this, the plan is "stale" —
   * Run would execute the old question, which is almost never what the
   * user wants.
   */
  const [planContext, setPlanContext] = useState<{
    question: string;
    collection: string | undefined;
  } | null>(null);
  /**
   * Cached history entry matching the currently-typed (question, collection).
   * When present, we offer "Reuse previous answer" to skip the LLM + Firestore.
   */
  const [cachedEntry, setCachedEntry] = useState<HistoryEntry | null>(null);

  const reloadCollections = useCallback(async () => {
    if (!activeProfile) return;
    try {
      const list = await ipc.collections.list();
      setCollections(list);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [activeProfile, toast]);

  useEffect(() => {
    setPlan(null);
    setOutcome(null);
    setSchema(null);
    setCollection('');
    setCollections([]);
    setPlanContext(null);
    setCachedEntry(null);
    // Only Firestore profiles expose `collections.list` — Postgres profiles
    // render a dedicated "coming soon" screen below and don't need this.
    if (activeProfile && activeProfile.engine === 'firestore') {
      void reloadCollections();
    }
  }, [activeProfile, reloadCollections]);

  useEffect(() => {
    if (!activeProfile || !collection) {
      setSchema(null);
      return;
    }
    void ipc.schema.get({ collection, collectionGroup: false }).then(setSchema);
  }, [activeProfile, collection]);

  async function buildPlan() {
    if (!activeProfile) return toast.push('Select a profile first.', 'error');
    if (!llm?.hasApiKey) return toast.push('Configure LLM API key in Settings.', 'error');
    if (!question.trim()) return toast.push('Type a question first.', 'error');
    const questionAtBuild = question.trim();
    const collectionAtBuild = normalizeCollection(collection);
    setBuilding(true);
    setOutcome(null);
    try {
      const res = await ipc.plan.build({
        question: questionAtBuild,
        collection: collectionAtBuild,
        allowScan: true,
        allowMulti: true,
      });
      if (!res.ok) {
        toast.push(`Plan failed: ${res.code} — ${res.message}`, 'error');
        setPlan(null);
        setPlanContext(null);
        return;
      }
      setPlan(res.plan);
      setPlanContext({ question: questionAtBuild, collection: collectionAtBuild });
      setRightTab('explain');
      if (autoRun) {
        await runPlan(res.plan, {
          question: questionAtBuild,
          collection: collectionAtBuild,
        });
      }
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBuilding(false);
    }
  }

  async function runPlan(
    p: QueryPlan,
    context?: { question: string; collection: string | undefined },
  ) {
    setRunning(true);
    try {
      const res = await ipc.execute.run({ plan: p });
      setOutcome(res);
      if (!res.ok) {
        toast.push(`Run failed: ${res.code}`, 'error');
      } else {
        toast.push(
          `Returned ${res.rows.length} row${res.rows.length === 1 ? '' : 's'}`,
          'success',
        );
      }
      // Persist to history. We save successes and failures both; failed
      // runs are still valuable to revisit (e.g. composite-index errors).
      const ctx = context ?? planContext;
      if (ctx) {
        try {
          await ipc.history.add({
            source: 'firestore',
            question: ctx.question,
            collection: ctx.collection,
            plan: p,
            outcome: res,
          });
        } catch (historyErr) {
          // Non-fatal: history persistence should never block the user.
          // eslint-disable-next-line no-console
          console.warn('Failed to save history entry', historyErr);
        }
      }
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setRunning(false);
    }
  }

  async function ensureSchema() {
    if (!collection || !activeProfile) return;
    if (schema && schema.fields.length > 0) return;
    try {
      const next = await ipc.schema.sample({ collection, collectionGroup: false });
      setSchema(next);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  useEffect(() => {
    if (collection && activeProfile) void ensureSchema();
  }, [collection, activeProfile]);

  /**
   * Debounced lookup of a prior history entry for the exact (question, collection)
   * pair the user is typing. If found, the UI surfaces a "Reuse previous answer"
   * chip so they can avoid a round-trip to the LLM and Firestore.
   */
  useEffect(() => {
    if (!activeProfile) {
      setCachedEntry(null);
      return;
    }
    const q = question.trim();
    if (!q) {
      setCachedEntry(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const res = await ipc.history.findCached({
          question: q,
          collection: normalizeCollection(collection),
        });
        if (!cancelled) setCachedEntry(res.entry);
      } catch {
        if (!cancelled) setCachedEntry(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [question, collection, activeProfile]);

  /**
   * When another tab (HistoryPage) hands off an entry, restore the full
   * query state so the user can inspect, tweak, or re-run.
   */
  useEffect(() => {
    if (!pendingHistory) return;
    if (!isFirestoreHistoryEntry(pendingHistory)) return;
    setQuestion(pendingHistory.question);
    setCollection(pendingHistory.collection ?? '');
    setPlan(pendingHistory.plan);
    setOutcome(pendingHistory.outcome);
    setPlanContext({
      question: pendingHistory.question,
      collection: pendingHistory.collection,
    });
    setRightTab('explain');
    clearPendingHistory();
  }, [pendingHistory, clearPendingHistory]);

  function reuseCachedEntry(entry: HistoryEntry) {
    if (!isFirestoreHistoryEntry(entry)) return;
    setPlan(entry.plan);
    setOutcome(entry.outcome);
    setPlanContext({
      question: entry.question,
      collection: entry.collection,
    });
    setRightTab('explain');
    toast.push('Loaded previous answer from history.', 'success');
  }

  const trimmedQ = question.trim();
  const currentCollection = normalizeCollection(collection);
  const isStale =
    plan !== null &&
    planContext !== null &&
    (planContext.question !== trimmedQ ||
      planContext.collection !== currentCollection);
  /**
   * A cache hit is only truly "new" info to the user if it doesn't match
   * the plan already in state; otherwise the chip just restates what's
   * on screen.
   */
  const canReuseCached =
    cachedEntry !== null &&
    (plan === null ||
      planContext?.question !== cachedEntry.question ||
      planContext?.collection !== cachedEntry.collection ||
      outcome === null);

  if (!activeProfile) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground animate-fade-in">
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-secondary/60 text-primary">
            <FileText size={22} />
            <span
              aria-hidden
              className="absolute inset-0 rounded-xl ring-2 ring-primary/40 animate-ping-soft"
            />
          </div>
          <div className="text-balance">
            Pick or create a profile from the <b>Profiles</b> tab to start querying.
          </div>
        </div>
      </div>
    );
  }

  if (isSqlProfile(activeProfile)) {
    return (
      <SqlQueryPanel
        profile={activeProfile}
        hasLlmConfigured={!!llm?.hasApiKey}
      />
    );
  }

  const busy = building || running;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-col lg:border-r lg:border-border">
        <div
          className={cn(
            'rounded-none border-b border-border p-3 transition-all',
            building && 'working-border',
          )}
        >
          <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto] md:grid-cols-[minmax(0,1fr)_220px_auto]">
            <div>
              <label className="label">
                <Sparkles size={10} className="mr-1 inline-block align-[-1px]" />
                Natural-language question
              </label>
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder='e.g. "which user has email alice@example.com"'
                rows={2}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (!busy) void buildPlan();
                  }
                }}
              />
            </div>
            <div>
              <label className="label">Collection</label>
              <div className="flex gap-1">
                <Select value={collection} onChange={(e) => setCollection(e.target.value)}>
                  <option value="">(let LLM pick)</option>
                  {collections.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={reloadCollections}
                  title="Reload collections"
                  aria-label="Reload collections"
                >
                  <RefreshCw size={12} className="transition-transform duration-300 hover:rotate-180" />
                </Button>
              </div>
              <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={autoRun}
                  onChange={(e) => setAutoRun(e.target.checked)}
                  className="h-3 w-3 accent-primary transition-all"
                />
                Run plan automatically after build
              </label>
            </div>
            <div className="flex flex-col gap-1 pt-4">
              <Button
                variant="primary"
                onClick={buildPlan}
                disabled={busy}
                loading={building}
                title={autoRun ? 'Build plan and run (⌘↵)' : 'Build plan (⌘↵)'}
              >
                {!building ? <Wand2 size={14} /> : null}
                {building ? 'Building…' : autoRun ? 'Ask' : 'Build plan'}
              </Button>
              <Button
                onClick={() => plan && runPlan(plan)}
                disabled={!plan || busy || isStale}
                loading={running}
                title={
                  isStale
                    ? 'Plan is stale — press Ask to rebuild for the new question.'
                    : 'Re-run the current plan without calling the LLM.'
                }
              >
                {!running ? <Play size={14} /> : null}
                {running ? 'Running…' : isStale ? 'Run (stale)' : 'Run'}
              </Button>
            </div>
          </div>
          {isStale ? (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-env-staging/40 bg-env-staging/10 px-2 py-1 text-[11px] text-env-staging animate-fade-in">
              <RefreshCw size={11} />
              <span>
                Plan is stale — it was built for a different question. Press{' '}
                <kbd className="rounded bg-secondary/60 px-1 py-0.5 font-mono">⌘ ↵</kbd> to rebuild.
              </span>
            </div>
          ) : null}
          {canReuseCached && cachedEntry ? (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary animate-fade-in">
              <HistoryIcon size={11} />
              <span>
                You asked this {formatRelativeTime(cachedEntry.createdAt)}
                {cachedEntry.outcome.ok
                  ? ` — ${cachedEntry.outcome.rows.length} row${cachedEntry.outcome.rows.length === 1 ? '' : 's'}.`
                  : ' — previous run failed.'}
              </span>
              <button
                type="button"
                onClick={() => reuseCachedEntry(cachedEntry)}
                className="ml-1 rounded border border-primary/60 bg-primary/20 px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/30"
              >
                Reuse
              </button>
            </div>
          ) : null}
          {collection ? (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground animate-fade-in">
              <span>Collection input field:</span>
              <Input
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
                className="h-6 max-w-xs py-0 text-xs"
                placeholder="collection id"
              />
            </div>
          ) : null}
        </div>

        <div className="min-h-[240px] flex-1 lg:min-h-0">
          {outcome === null ? (
            <EmptyResults plan={plan} />
          ) : outcome.ok ? (
            <ResultsTable
              rows={outcome.rows}
              warnings={outcome.warnings}
              question={planContext?.question ?? question}
              collection={planContext?.collection ?? normalizeCollection(collection)}
              plan={plan}
              outcome={outcome}
            />
          ) : (
            <ErrorView outcome={outcome} />
          )}
        </div>

        {outcome?.ok ? (
          <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground animate-fade-in-up">
            <Stat label="mode" value={outcome.stats.mode} />
            <Stat label="scanned" value={outcome.stats.scanned} />
            <Stat label="matched" value={outcome.stats.matched} />
            <Stat label="returned" value={outcome.stats.returned} />
            <Stat label="time" value={`${outcome.stats.durationMs.toFixed(0)}ms`} />
            {outcome.stats.truncated ? (
              <span className="rounded-sm bg-env-staging/20 px-1.5 py-0.5 text-env-staging">truncated</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col border-t border-border lg:border-t-0">
        <RightTabs active={rightTab} onChange={setRightTab} />
        <div className="min-h-[320px] flex-1 lg:min-h-0">
          {rightTab === 'explain' ? (
            <div key="explain" className="h-full animate-fade-in">
              {plan ? (
                <ExplainPanel plan={plan} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-muted/30 text-muted-foreground">
                    <Wand2 size={20} />
                  </div>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Build a plan to see its explanation, pseudo-code, and JSON here.
                  </p>
                </div>
              )}
            </div>
          ) : rightTab === 'insights' ? (
            <div key="insights" className="h-full animate-fade-in">
              <InsightsPanel
                question={trimmedQ}
                collection={currentCollection}
                plan={plan}
                outcome={outcome}
              />
            </div>
          ) : (
            <div key="schema" className="h-full animate-fade-in">
              <SchemaEditor collection={collection} schema={schema} onRefreshed={setSchema} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="font-mono text-foreground/90">{value}</span>
    </span>
  );
}

function EmptyResults({ plan }: { plan: QueryPlan | null }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground animate-fade-in">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary/60 text-primary">
          {plan ? <Play size={16} /> : <Sparkles size={16} />}
        </div>
        <div>
          {plan
            ? 'Plan ready — press Run to execute.'
            : 'Build a plan from your question to see results here.'}
        </div>
        {!plan ? (
          <div className="text-[11px] text-muted-foreground/70">
            Tip: press <kbd className="rounded bg-secondary px-1 py-0.5 font-mono">⌘ ↵</kbd> to build.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RightTabs({ active, onChange }: { active: RightTab; onChange: (t: RightTab) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLButtonElement>(`[data-rtab="${active}"]`);
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    setIndicator({ left: rect.left - containerRect.left, width: rect.width });
  }, [active]);

  return (
    <div ref={containerRef} className="relative flex items-center border-b border-border">
      {(['explain', 'insights', 'schema'] as RightTab[]).map((t) => (
        <button
          key={t}
          data-rtab={t}
          onClick={() => onChange(t)}
          className={cn(
            'relative px-3 py-2 text-xs font-medium capitalize transition-colors',
            active === t ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t}
        </button>
      ))}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 h-0.5 rounded-t-sm bg-primary transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]"
        style={{
          left: indicator.left,
          width: indicator.width,
          opacity: indicator.width ? 1 : 0,
        }}
      />
    </div>
  );
}

function ErrorView({ outcome }: { outcome: Extract<RunOutcome, { ok: false }> }) {
  return (
    <div className="p-4 animate-fade-in">
      <div className="mb-2 text-sm font-semibold text-destructive">Run failed: {outcome.code}</div>
      <pre className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
        {outcome.message}
      </pre>
      {outcome.indexHint?.url ? (
        <div className="mt-3">
          <a
            href={outcome.indexHint.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-md border border-primary/60 bg-primary/20 px-2 py-1 text-xs text-primary transition-all hover:-translate-y-px hover:bg-primary/30 hover:shadow-lift"
          >
            <ExternalLink size={12} />
            Create composite index
          </a>
        </div>
      ) : null}
    </div>
  );
}
