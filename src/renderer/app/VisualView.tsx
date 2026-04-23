import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type {
  VisualsGenerateOutcome,
  VisualsGenerateRequest,
} from '@shared/types/ipc';
import type { VisualPlan, VisualSpec } from '@shared/types/visualPlan';
import { ipc } from '../lib/ipcClient';
import { Button } from '../components/ui/button';
import { VisualRenderer } from '../components/charts/registry';
import { cn } from '../lib/utils';

interface VisualViewProps {
  /**
   * Stable cache key for the current results. When it changes, we
   * invalidate the cached plan so the user gets fresh charts for the
   * new result set instead of stale ones.
   */
  cacheKey: string;
  /**
   * Factory producing the IPC request. Passed as a function so callers
   * don't have to recompute a potentially large `rows` array on every
   * render just to pass it as a prop.
   */
  buildRequest: () => VisualsGenerateRequest;
  /** Passed through to the request — shown in the empty state. */
  hasRows: boolean;
}

interface CachedPlan {
  cacheKey: string;
  plan: VisualPlan;
  model?: string;
  elapsedMs: number;
  rowSampleTruncated: boolean;
  specsDropped: number;
  generatedAt: number;
}

/**
 * Body-level "Visual" view. Shown when the user picks Visual in the
 * toolbar. Lazily calls `ipc.visuals.generate` the first time it
 * renders for a new `cacheKey`, then renders the returned chart specs
 * via the registry.
 */
export function VisualView({ cacheKey, buildRequest, hasRows }: VisualViewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [cached, setCached] = useState<CachedPlan | null>(null);
  const abortRef = useRef<{ aborted: boolean } | null>(null);

  // Invalidate cache when the key changes (new query run).
  useEffect(() => {
    if (cached && cached.cacheKey !== cacheKey) {
      setCached(null);
      setError(null);
    }
  }, [cacheKey, cached]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.aborted = true;
    };
  }, [cacheKey]);

  async function generate() {
    if (!hasRows) return;
    setLoading(true);
    setError(null);
    const token = { aborted: false };
    abortRef.current = token;
    try {
      const req = buildRequest();
      const res: VisualsGenerateOutcome = await ipc.visuals.generate(req);
      if (token.aborted) return;
      if (!res.ok) {
        setError({ code: res.code, message: res.message });
        setCached(null);
        return;
      }
      setCached({
        cacheKey,
        plan: res.plan,
        model: res.model,
        elapsedMs: res.elapsedMs,
        rowSampleTruncated: res.rowSampleTruncated,
        specsDropped: res.specsDropped,
        generatedAt: Date.now(),
      });
    } catch (err) {
      if (token.aborted) return;
      setError({
        code: 'UNEXPECTED',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (!token.aborted) setLoading(false);
    }
  }

  // Auto-generate on first mount when rows exist and we don't yet
  // have a cached plan for the current cache key.
  useEffect(() => {
    if (!hasRows) return;
    if (cached && cached.cacheKey === cacheKey) return;
    if (loading) return;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, hasRows]);

  return (
    <div className="flex h-full min-h-0 flex-col animate-fade-in">
      <Header
        cached={cached}
        loading={loading}
        hasRows={hasRows}
        onRegenerate={generate}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {!hasRows ? (
          <EmptyState
            icon={<BarChart3 size={16} />}
            message="No rows to visualize. Run a query with results to generate charts."
          />
        ) : error ? (
          <div className="m-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <div>
              <div className="font-semibold">{error.code}</div>
              <div className="mt-1 whitespace-pre-wrap text-foreground/90">
                {error.message}
              </div>
              <div className="mt-2">
                <Button size="sm" variant="ghost" onClick={generate}>
                  <RefreshCw size={12} /> Retry
                </Button>
              </div>
            </div>
          </div>
        ) : loading && !cached ? (
          <LoadingSkeleton />
        ) : cached ? (
          <PlanGrid plan={cached.plan} />
        ) : (
          <EmptyState
            icon={<Sparkles size={16} />}
            message="Click Generate to let the model pick charts for this result set."
          />
        )}
        {cached ? (
          <FooterNotes
            truncated={cached.rowSampleTruncated}
            dropped={cached.specsDropped}
            specCount={cached.plan.specs.length}
          />
        ) : null}
      </div>
    </div>
  );
}

function Header({
  cached,
  loading,
  hasRows,
  onRegenerate,
}: {
  cached: CachedPlan | null;
  loading: boolean;
  hasRows: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-glow-primary">
        <BarChart3 size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Visual summary</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {cached
            ? `${cached.plan.specs.length} chart${cached.plan.specs.length === 1 ? '' : 's'}${
                cached.model ? ` · ${cached.model}` : ''
              } · ${formatDuration(cached.elapsedMs)} · generated ${formatRelative(cached.generatedAt)}`
            : loading
              ? 'Asking the model for chart suggestions…'
              : hasRows
                ? 'AI will pick chart types and pre-aggregate your data.'
                : 'Run a query to generate visualizations.'}
        </div>
      </div>
      <Button
        size="sm"
        variant={cached ? 'default' : 'primary'}
        onClick={onRegenerate}
        loading={loading}
        disabled={loading || !hasRows}
        title={cached ? 'Regenerate charts' : 'Generate charts for this result set'}
      >
        {!loading ? (
          cached ? <RefreshCw size={12} /> : <Sparkles size={12} />
        ) : null}
        {loading ? 'Thinking…' : cached ? 'Regenerate' : 'Generate'}
      </Button>
    </div>
  );
}

function PlanGrid({ plan }: { plan: VisualPlan }) {
  if (plan.specs.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 size={16} />}
        message={
          plan.narrative
            ? plan.narrative
            : 'The model didn\u2019t find a good chart for this result set.'
        }
      />
    );
  }
  return (
    <div className="p-3">
      {plan.narrative ? (
        <div className="mb-3 rounded-md border border-border/60 bg-secondary/30 px-3 py-2 text-xs leading-relaxed text-foreground/90">
          <span className="mr-1 font-semibold text-primary">TL;DR</span>
          {plan.narrative}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {plan.specs.map((spec, i) => (
          <SpecCell key={i} spec={spec} />
        ))}
      </div>
    </div>
  );
}

function SpecCell({ spec }: { spec: VisualSpec }) {
  // KPI cards are dense and look odd at full column width in the grid;
  // let them sit in their natural size without min-height.
  if (spec.type === 'kpi') {
    return (
      <div className="min-h-0">
        <VisualRenderer spec={spec} />
      </div>
    );
  }
  return (
    <div className={cn('min-h-[260px]', spec.type === 'pie' && 'min-h-[280px]')}>
      <VisualRenderer spec={spec} />
    </div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground animate-fade-in">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary/60 text-primary">
          {icon}
        </div>
        <div className="max-w-sm text-balance">{message}</div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-56 animate-pulse rounded-md border border-border/40 bg-secondary/20"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

function FooterNotes({
  truncated,
  dropped,
  specCount,
}: {
  truncated: boolean;
  dropped: number;
  specCount: number;
}) {
  if (!truncated && dropped === 0) return null;
  return (
    <div className="mx-3 mb-3 flex flex-col gap-1 text-[11px] text-muted-foreground">
      {truncated ? (
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={11} className="text-env-staging" />
          Charts were generated from a truncated sample of the returned rows.
        </div>
      ) : null}
      {dropped > 0 ? (
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={11} className="text-env-staging" />
          {dropped} chart spec{dropped === 1 ? '' : 's'} were rejected by validation
          ({specCount} kept).
        </div>
      ) : null}
    </div>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
