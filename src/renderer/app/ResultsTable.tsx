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
  Braces,
  Check,
  ChevronRight,
  Copy,
  Download,
  Rows3,
} from 'lucide-react';
import type { ResultRow } from '@shared/types/results';
import { Button } from '../components/ui/button';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/utils';

interface ResultsTableProps {
  rows: ResultRow[];
  warnings: string[];
}

type ViewMode = 'table' | 'json';

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function formatCellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

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
/*  Download helpers                                                   */
/* ------------------------------------------------------------------ */

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: ResultRow[], columns: string[]): string {
  const esc = (v: unknown) => {
    const s = formatCellText(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = ['__id', '__path', ...columns].map(esc).join(',');
  const body = rows
    .map((r) => [r.id, r.path, ...columns.map((c) => r.data[c])].map(esc).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ResultsTable({ rows, warnings }: ResultsTableProps) {
  const toast = useToast();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('table');

  const columnNames = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows) {
      for (const k of Object.keys(row.data)) {
        seen.add(k);
      }
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
    download(`fqs-results-${Date.now()}.json`, JSON.stringify(sorted, null, 2), 'application/json');
  }
  function exportCsv() {
    const sorted = rowModel.rows.map((r) => r.original);
    download(`fqs-results-${Date.now()}.csv`, toCsv(sorted, columnNames), 'text/csv');
  }

  return (
    <div className="flex h-full flex-col animate-fade-in">
      {/* toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card/40 px-3 py-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            <span className="font-mono text-foreground/90">{rows.length}</span> row{rows.length === 1 ? '' : 's'}
          </span>
          {columnNames.length > 0 ? (
            <span className="text-muted-foreground/70">
              · <span className="font-mono text-foreground/80">{columnNames.length}</span> field{columnNames.length === 1 ? '' : 's'}
            </span>
          ) : null}
          {warnings.length > 0 ? (
            <span className="text-env-staging">
              · {warnings.length} warning{warnings.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          <div className="flex gap-1">
            <Button size="sm" onClick={exportJson} title="Export as JSON">
              <Download size={12} /> JSON
            </Button>
            <Button size="sm" onClick={exportCsv} title="Export as CSV">
              <Download size={12} /> CSV
            </Button>
          </div>
        </div>
      </div>

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
                                  // match zebra background on sticky cell
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

function SortIcon({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  if (sorted === 'asc') return <ArrowUp size={10} className="text-primary" />;
  if (sorted === 'desc') return <ArrowDown size={10} className="text-primary" />;
  return <ArrowUpDown size={10} className="opacity-0 transition-opacity group-hover:opacity-60" />;
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLButtonElement>(`[data-view="${view}"]`);
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    setIndicator({ left: rect.left - containerRect.left, width: rect.width });
  }, [view]);

  const opts: Array<{ id: ViewMode; label: string; icon: React.ReactNode }> = [
    { id: 'table', label: 'Table', icon: <Rows3 size={12} /> },
    { id: 'json', label: 'JSON', icon: <Braces size={12} /> },
  ];

  return (
    <div
      ref={containerRef}
      className="relative flex items-center rounded-md border border-border/60 bg-secondary/40 p-0.5"
      role="tablist"
      aria-label="Results view"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-[4px] bg-primary/20 shadow-soft transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]"
        style={{
          transform: `translateX(${indicator.left}px)`,
          width: indicator.width ? `${indicator.width}px` : 0,
          opacity: indicator.width ? 1 : 0,
        }}
      />
      {opts.map((o) => (
        <button
          key={o.id}
          data-view={o.id}
          role="tab"
          aria-selected={view === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'relative z-10 inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-[11px] font-medium transition-colors',
            view === o.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function JsonView({ rows }: { rows: ResultRow[] }) {
  const toast = useToast();
  const [copiedAll, setCopiedAll] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const json = useMemo(() => JSON.stringify(rows, null, 2), [rows]);
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
      <div className="pointer-events-none absolute right-3 top-2 z-10">
        <div className="pointer-events-auto">
          <Button size="sm" variant="ghost" onClick={copyAll} title="Copy all JSON">
            {copiedAll ? (
              <Check size={12} className="text-env-dev animate-scale-in" />
            ) : (
              <Copy size={12} />
            )}
            {copiedAll ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <div
        ref={scrollRef}
        // `h-0 flex-1` gives the scroll container an explicit minimum size
        // in a flex column, which together with `overflow-auto` guarantees
        // that tall JSON payloads scroll inside this panel instead of
        // pushing ancestors. `overscroll-contain` stops scroll chaining.
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
