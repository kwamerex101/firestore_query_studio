import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronRight,
  Copy,
} from 'lucide-react';
import type { QueryPlan } from '@shared/types/plan';
import type { ResultRow, RunOutcome } from '@shared/types/results';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/utils';
import { firestoreRowsToCsv, formatCellText } from '@shared/csv';
import { downloadText } from '../lib/download';
import { ResultsToolbar, type ResultsViewMode } from './ResultsToolbar';
import { VisualView } from './VisualView';

interface ResultsTableProps {
  rows: ResultRow[];
  warnings: string[];
  /**
   * Context for the AI Visual view. When all three are provided (and
   * `rows.length > 0`) the Visual menu generates charts on demand.
   */
  question?: string;
  collection?: string;
  plan?: QueryPlan | null;
  outcome?: RunOutcome | null;
}

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function valueKind(v: unknown): 'null' | 'boolean' | 'number' | 'string' | 'object' {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  return 'object';
}

function Cell({ value }: { value: unknown }) {
  const kind = valueKind(value);

  if (kind === 'null') {
    return <span className="font-mono text-[11px] italic text-muted-foreground/60">null</span>;
  }
  if (kind === 'boolean') {
    const b = value as boolean;
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px]',
          b
            ? 'border-env-dev/40 bg-env-dev/10 text-env-dev'
            : 'border-destructive/40 bg-destructive/10 text-destructive',
        )}
      >
        {String(b)}
      </span>
    );
  }
  if (kind === 'number') {
    return <span className="font-mono text-[11px] tabular-nums text-foreground/90">{String(value)}</span>;
  }
  if (kind === 'object') {
    const text = formatCellText(value);
    return (
      <span
        className="block max-w-[320px] truncate font-mono text-[11px] text-primary/90"
        title={text}
      >
        {text}
      </span>
    );
  }
  const s = value as string;
  return (
    <span className="block max-w-[320px] truncate font-mono text-[11px] text-foreground/90" title={s}>
      {s}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ResultsTable({
  rows,
  warnings,
  question,
  collection,
  plan,
  outcome,
}: ResultsTableProps) {
  const toast = useToast();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [view, setView] = useState<ResultsViewMode>('table');

  const columnNames = useMemo(() => {
    // Column discovery is O(rows × fields) in the worst case, and Firestore
    // documents often share a schema, so we only scan the first 200 rows
    // (and then the last row as a cheap "shape drift" check). This keeps
    // renders cheap for 100k-row streams while still catching the common
    // case of a late-added field.
    const seen = new Set<string>();
    const sampleCount = Math.min(rows.length, 200);
    for (let i = 0; i < sampleCount; i += 1) {
      for (const k of Object.keys(rows[i].data)) seen.add(k);
    }
    if (rows.length > sampleCount) {
      for (const k of Object.keys(rows[rows.length - 1].data)) seen.add(k);
    }
    return Array.from(seen).sort();
  }, [rows]);

  const flashCopied = (key: string, message: string) => {
    void navigator.clipboard.writeText(key);
    setCopied(key);
    toast.push(message, 'success');
    window.setTimeout(() => {
      setCopied((cur) => (cur === key ? null : cur));
    }, 1200);
  };

  const columns = useMemo<ColumnDef<ResultRow>[]>(() => {
    const base: ColumnDef<ResultRow>[] = [
      {
        id: '__id',
        header: 'Document ID',
        accessorFn: (row) => row.id,
        cell: ({ row }) => {
          const idKey = `id:${row.original.id}`;
          const pathKey = `path:${row.original.path}`;
          const isIdCopied = copied === idKey;
          const isPathCopied = copied === pathKey;
          return (
            <div className="group flex items-center gap-1">
              <span
                className="truncate font-mono text-[11px] text-foreground/90"
                title={row.original.path}
              >
                {row.original.id}
              </span>
              <div className="ml-auto flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 data-[show=true]:opacity-100" data-show={isIdCopied || isPathCopied}>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    flashCopied(idKey, 'Copied document ID');
                  }}
                  title="Copy document ID"
                  aria-label="Copy document ID"
                >
                  {isIdCopied ? (
                    <Check size={11} className="text-env-dev animate-scale-in" />
                  ) : (
                    <Copy size={11} />
                  )}
                </button>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    void navigator.clipboard.writeText(row.original.path);
                    setCopied(pathKey);
                    toast.push('Copied document path', 'success');
                    window.setTimeout(() => {
                      setCopied((cur) => (cur === pathKey ? null : cur));
                    }, 1200);
                  }}
                  title={`Copy path: ${row.original.path}`}
                  aria-label="Copy document path"
                >
                  {isPathCopied ? (
                    <Check size={11} className="text-env-dev animate-scale-in" />
                  ) : (
                    <ChevronRight size={11} />
                  )}
                </button>
              </div>
            </div>
          );
        },
        size: 260,
      },
    ];
    for (const name of columnNames) {
      base.push({
        id: name,
        header: name,
        accessorFn: (row) => row.data[name],
        cell: (ctx) => <Cell value={ctx.getValue()} />,
      });
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnNames, copied]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowModel = table.getRowModel();
  const virtualizer = useVirtualizer({
    count: rowModel.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 12,
  });

  function exportJson() {
    const sorted = rowModel.rows.map((r) => r.original);
    downloadText(
      `fqs-results-${Date.now()}.json`,
      JSON.stringify(sorted, null, 2),
      'application/json',
    );
  }
  function exportCsv() {
    const sorted = rowModel.rows.map((r) => r.original);
    downloadText(
      `fqs-results-${Date.now()}.csv`,
      firestoreRowsToCsv(sorted, columnNames),
      'text/csv',
    );
  }

  // Cache key for the Visual view. `rows` identity changes on every
  // new run, so identity alone is enough for invalidation; we mix in
  // `rows.length` and the first row's id to be extra safe against
  // memoisation surprises.
  const visualCacheKey = useMemo(() => {
    return `fs:${rows.length}:${rows[0]?.id ?? ''}:${rows[rows.length - 1]?.id ?? ''}`;
  }, [rows]);

  const canVisualize =
    !!question && !!plan && !!outcome && outcome.ok && rows.length > 0;

  return (
    <div className="flex h-full flex-col animate-fade-in">
      <ResultsToolbar
        stats={{ rows: rows.length, columns: columnNames.length, warnings: warnings.length }}
        view={view}
        onViewChange={setView}
        onDownloadJson={exportJson}
        onDownloadCsv={exportCsv}
        canVisualize={canVisualize}
        visualizeHint={
          canVisualize
            ? 'AI-generated infographics based on the current results'
            : rows.length === 0
              ? 'No rows to visualize'
              : 'Visual charts require a completed query'
        }
      />

      {warnings.length > 0 ? (
        <div className="border-b border-env-staging/40 bg-env-staging/10 px-3 py-2 text-xs text-env-staging animate-fade-in-down">
          {warnings.map((w, i) => (
            <div key={i}>• {w}</div>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No rows returned.
        </div>
      ) : view === 'visual' ? (
        <div className="min-h-0 flex-1">
          <VisualView
            cacheKey={visualCacheKey}
            hasRows={canVisualize}
            buildRequest={() => ({
              source: 'firestore',
              question: question ?? '(no question)',
              collection,
              // `canVisualize` gates this path; the non-null assertions
              // are safe because we only render Visual when all three
              // are present.
              plan: plan as QueryPlan,
              outcome: outcome as RunOutcome,
            })}
          />
        </div>
      ) : view === 'cards' ? (
        <CardsView rows={rowModel.rows.map((r) => r.original)} />
      ) : view === 'table' ? (
        <div ref={scrollRef} className="flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-left text-xs">
            <thead className="sticky top-0 z-20 bg-card/95 backdrop-blur">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h, colIdx) => {
                    const sorted = h.column.getIsSorted();
                    const isFirst = colIdx === 0;
                    return (
                      <th
                        key={h.id}
                        onClick={h.column.getToggleSortingHandler()}
                        className={cn(
                          'group cursor-pointer select-none whitespace-nowrap border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground',
                          sorted && 'text-primary',
                          isFirst && 'sticky left-0 z-30 bg-card/95 backdrop-blur',
                        )}
                        style={{ minWidth: 140 }}
                      >
                        <span className="inline-flex items-center gap-1">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <SortIcon sorted={sorted} />
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
              {virtualizer.getVirtualItems().map((vr) => {
                const row = rowModel.rows[vr.index];
                const zebra = vr.index % 2 === 1;
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'group absolute left-0 right-0 border-b border-border/30 transition-colors',
                      zebra ? 'bg-card/30' : 'bg-transparent',
                      'hover:bg-primary/5',
                    )}
                    style={{ transform: `translateY(${vr.start}px)`, height: 34 }}
                  >
                    {row.getVisibleCells().map((c, idx) => {
                      const isFirst = idx === 0;
                      return (
                        <td
                          key={c.id}
                          className={cn(
                            'border-b border-border/20 px-3 py-1.5 align-middle',
                            isFirst &&
                              'sticky left-0 z-10 bg-[hsl(var(--background))]/95 backdrop-blur group-hover:bg-[hsl(var(--background))]',
                          )}
                          style={
                            isFirst
                              ? {
                                  background: zebra
                                    ? 'linear-gradient(hsl(var(--card) / 0.55), hsl(var(--card) / 0.55)), hsl(var(--background))'
                                    : 'hsl(var(--background))',
                                }
                              : undefined
                          }
                        >
                          {flexRender(c.column.columnDef.cell, c.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <JsonView rows={rowModel.rows.map((r) => r.original)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const CARDS_MAX_ROWS = 500;
function CardsView({ rows }: { rows: ResultRow[] }) {
  const capped = rows.length > CARDS_MAX_ROWS ? rows.slice(0, CARDS_MAX_ROWS) : rows;
  const truncated = rows.length > capped.length;
  return (
    <div className="flex-1 overflow-auto p-3">
      {truncated && (
        <p className="mb-2 text-xs text-muted-foreground">
          Showing first {CARDS_MAX_ROWS} of {rows.length} rows. Use Download to get all.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {capped.map((row) => (
          <div
            key={row.id}
            className="rounded-lg border border-border bg-card px-4 py-3 text-xs shadow-soft"
          >
            <p className="mb-2 truncate font-mono text-[10px] text-muted-foreground">
              {row.id}
            </p>
            <dl className="space-y-1">
              {Object.entries(row.data).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-1/3 shrink-0 truncate font-semibold text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 flex-1 truncate text-foreground">
                    {v === null || v === undefined
                      ? <span className="italic text-muted-foreground">null</span>
                      : typeof v === 'object'
                      ? <span className="font-mono">{JSON.stringify(v)}</span>
                      : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

function SortIcon({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  if (sorted === 'asc') return <ArrowUp size={10} className="text-primary" />;
  if (sorted === 'desc') return <ArrowDown size={10} className="text-primary" />;
  return <ArrowUpDown size={10} className="opacity-0 transition-opacity group-hover:opacity-60" />;
}

const JSON_VIEW_MAX_ROWS = 2_000;
function JsonView({ rows }: { rows: ResultRow[] }) {
  const toast = useToast();
  const [copiedAll, setCopiedAll] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Large result sets (>> 10k rows) make `JSON.stringify(rows, null, 2)`
  // expensive enough to freeze the renderer for seconds. Cap the preview
  // and expose the full payload through the explicit Download buttons.
  const capped = useMemo(
    () => (rows.length > JSON_VIEW_MAX_ROWS ? rows.slice(0, JSON_VIEW_MAX_ROWS) : rows),
    [rows],
  );
  const jsonPreviewTruncated = rows.length > capped.length;
  const json = useMemo(() => JSON.stringify(capped, null, 2), [capped]);
  const highlighted = useMemo(() => highlightJson(json), [json]);

  // Reset scroll to top whenever the rendered payload changes so users
  // don't land mid-document after running a new query.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [json]);

  function copyAll() {
    void navigator.clipboard.writeText(json);
    toast.push('Copied all rows as JSON', 'success');
    setCopiedAll(true);
    window.setTimeout(() => setCopiedAll(false), 1200);
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {jsonPreviewTruncated ? (
        <div className="border-b border-env-staging/40 bg-env-staging/10 px-3 py-1.5 text-[11px] text-env-staging">
          Showing the first {capped.length.toLocaleString()} of{' '}
          {rows.length.toLocaleString()} rows as JSON. Use the Download button
          to export the full result.
        </div>
      ) : null}
      <div className="pointer-events-none absolute right-3 top-2 z-10">
        <div className="pointer-events-auto">
          <button
            type="button"
            onClick={copyAll}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-secondary/60 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title="Copy all JSON"
          >
            {copiedAll ? (
              <Check size={12} className="text-env-dev animate-scale-in" />
            ) : (
              <Copy size={12} />
            )}
            {copiedAll ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="h-0 flex-1 overflow-auto overscroll-contain focus:outline-none"
        tabIndex={0}
        aria-label="Results JSON, scrollable"
      >
        <pre
          className="m-0 whitespace-pre px-4 py-3 pr-20 font-mono text-[11px] leading-[1.55] text-foreground/90"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tiny, safe JSON syntax highlighter                                 */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightJson(json: string): string {
  const escaped = escapeHtml(json);
  return escaped.replace(
    /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'text-foreground/90';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'text-primary' : 'text-env-dev';
      } else if (/^(true|false)$/.test(match)) {
        cls = 'text-env-staging';
      } else if (/^null$/.test(match)) {
        cls = 'text-muted-foreground italic';
      } else {
        cls = 'text-env-staging';
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );
}
