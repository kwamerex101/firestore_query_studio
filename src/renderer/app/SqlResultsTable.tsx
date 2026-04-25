import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Copy } from 'lucide-react';
import type { SqlColumn, SqlRow } from '@shared/types/ipc';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/utils';
import { formatCellText, sqlRowsToCsv, sqlRowsToTsv } from '@shared/csv';
import { downloadText } from '../lib/download';
import { copyTsvAndOpenSheets, toSheetsMatrix } from '../lib/sheetsExport';
import { ipc } from '../lib/ipcClient';
import { ResultsToolbar, type ResultsViewMode } from './ResultsToolbar';
import { VisualView } from './VisualView';

interface SqlResultsTableProps {
  columns: SqlColumn[];
  rows: SqlRow[];
  /**
   * Context forwarded to the Visual view so the AI can reason about
   * the original intent + executed SQL. When any of these is missing
   * the Visual menu is still available, but the LLM request is fired
   * with defaults.
   */
  question?: string;
  sql?: string;
  truncated?: boolean;
  elapsedMs?: number;
}

/**
 * Virtualized tabular view for relational query results with a shared
 * toolbar (View / Visual / Download). Ordered columns come from the
 * driver so the `{columns, rows}` shape already matches what a CSV /
 * JSON export expects.
 */
export function SqlResultsTable({
  columns,
  rows,
  question,
  sql,
  truncated = false,
  elapsedMs,
}: SqlResultsTableProps) {
  const [view, setView] = useState<ResultsViewMode>('table');
  const toast = useToast();

  const canVisualize = rows.length > 0 && !!sql;
  const visualCacheKey = useMemo(() => {
    return `sql:${rows.length}:${columns.length}:${sql?.slice(0, 40) ?? ''}`;
  }, [rows.length, columns.length, sql]);

  function exportJson() {
    downloadText(
      `fqs-sql-${Date.now()}.json`,
      JSON.stringify(rows, null, 2),
      'application/json',
    );
  }
  function exportCsv() {
    downloadText(
      `fqs-sql-${Date.now()}.csv`,
      sqlRowsToCsv(rows, columns),
      'text/csv',
    );
  }
  async function copyForSheets() {
    await copyTsvAndOpenSheets(sqlRowsToTsv(rows, columns), toast);
  }

  async function exportToSheetsApi() {
    const headers = columns.map((c) => c.name);
    const matrix = toSheetsMatrix(headers, rows);
    const title = question
      ? `${question.slice(0, 80)} · ${new Date().toLocaleString()}`
      : `SQL export · ${new Date().toLocaleString()}`;
    toast.push('Creating Google Sheet…', 'info');
    const res = await ipc.sheets.exportCreate({
      title,
      columns: headers,
      rows: matrix,
    });
    if (res.ok) {
      toast.push(`Exported ${res.rowCount} rows — opening sheet…`, 'success');
      window.setTimeout(() => {
        try { window.open(res.spreadsheetUrl, '_blank', 'noopener,noreferrer'); } catch { /* popup-blocked */ }
      }, 150);
    } else {
      toast.push(`Sheets export failed: ${res.message}`, 'error');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResultsToolbar
        stats={{
          rows: rows.length,
          columns: columns.length,
          extra:
            typeof elapsedMs === 'number' ? (
              <span className="text-muted-foreground/70">
                · <span className="font-mono text-foreground/80">{elapsedMs}</span>
                ms
              </span>
            ) : null,
        }}
        view={view}
        onViewChange={setView}
        onDownloadJson={exportJson}
        onDownloadCsv={exportCsv}
        onCopyForSheets={rows.length > 0 ? copyForSheets : undefined}
        onExportToSheets={rows.length > 0 ? exportToSheetsApi : undefined}
        canVisualize={canVisualize}
        visualizeHint={
          canVisualize
            ? 'AI-generated infographics based on the query results'
            : rows.length === 0
              ? 'No rows to visualize'
              : 'Visual charts require executed SQL context'
        }
      />
      {truncated ? (
        <div className="border-b border-env-staging/40 bg-env-staging/10 px-3 py-1.5 text-[11px] text-env-staging">
          Output was truncated by the driver — some rows may not appear below.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No rows.
        </div>
      ) : view === 'visual' ? (
        <div className="min-h-0 flex-1">
          <VisualView
            cacheKey={visualCacheKey}
            hasRows={canVisualize}
            buildRequest={() => ({
              source: 'sql',
              question: question?.trim() || '(no question)',
              sql: sql ?? '',
              columns,
              rows,
              truncated,
            })}
          />
        </div>
      ) : view === 'cards' ? (
        <SqlCardsView columns={columns} rows={rows} />
      ) : view === 'json' ? (
        <JsonView rows={rows} />
      ) : (
        <SqlTableBody columns={columns} rows={rows} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Table body (virtualized)                                           */
/* ------------------------------------------------------------------ */

/** Resolves a cell for drivers where row key casing may differ from metadata. */
function getSqlCellValue(row: SqlRow, columnName: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, columnName)) {
    return row[columnName];
  }
  const lower = columnName.toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === lower) return row[k];
  }
  return undefined;
}

function SqlTableBody({
  columns,
  rows,
}: {
  columns: SqlColumn[];
  rows: SqlRow[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const tableColumns = useMemo<ColumnDef<SqlRow>[]>(() => {
    return columns.map<ColumnDef<SqlRow>>((c, idx) => ({
      id: `${c.name}-${idx}`,
      header: c.name,
      accessorFn: (row) => getSqlCellValue(row, c.name),
      cell: (ctx) => <SqlCell value={ctx.getValue()} />,
    }));
  }, [columns]);

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const rowModel = table.getRowModel();
  const virtualizer = useVirtualizer({
    count: rowModel.rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 32,
    overscan: 12,
  });

  /**
   * `position: absolute` on <tr> removes rows from the table column model, so
   * body cells no longer line up with <thead> — everything visually collapses
   * left. A shared CSS grid (same `gridTemplateColumns` for header + each row)
   * keeps virtualized rows aligned. See: HTML table + absolute rows issue.
   */
  const colCount = tableColumns.length;
  const gridTemplateColumns =
    colCount > 0
      ? {
          display: 'grid' as const,
          gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
        }
      : {};

  return (
    <div ref={containerRef} className="relative h-full w-full min-w-0 overflow-auto">
      {colCount > 0 ? (
        <div
          role="table"
          className="min-w-max border-b border-border text-xs"
          style={{ minWidth: `${Math.max(100, colCount * 120)}px` }}
        >
          {table.getHeaderGroups().map((hg) => (
            <div
              key={hg.id}
              role="row"
              className="sticky top-0 z-10 border-b border-border bg-background/95 py-0 backdrop-blur"
              style={gridTemplateColumns}
            >
              {hg.headers.map((header) => (
                <div
                  key={header.id}
                  role="columnheader"
                  className="min-w-0 whitespace-nowrap border-b border-border/60 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </div>
              ))}
            </div>
          ))}

          <div
            className="relative"
            style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%' }}
          >
            {virtualizer.getVirtualItems().map((v) => {
              const row = rowModel.rows[v.index];
              return (
                <div
                  key={row.id}
                  role="row"
                  className="absolute left-0 right-0 box-border items-center border-b border-border/50 hover:bg-accent/30"
                  style={{
                    ...gridTemplateColumns,
                    top: 0,
                    height: `${v.size}px`,
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div
                      key={cell.id}
                      role="cell"
                      className="min-w-0 border-r border-border/15 px-3 py-1.5 align-middle last:border-r-0"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SqlCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <span className="font-mono text-[11px] italic text-muted-foreground/60">
        null
      </span>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px]',
          value
            ? 'border-env-dev/40 bg-env-dev/10 text-env-dev'
            : 'border-destructive/40 bg-destructive/10 text-destructive',
        )}
      >
        {String(value)}
      </span>
    );
  }
  if (typeof value === 'number') {
    return (
      <span className="font-mono text-[11px] tabular-nums text-foreground/90">
        {String(value)}
      </span>
    );
  }
  const text = formatCellText(value);
  return (
    <span
      className="block max-w-[320px] truncate font-mono text-[11px] text-foreground/90"
      title={text}
    >
      {text}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Cards view                                                         */
/* ------------------------------------------------------------------ */

const CARDS_MAX_ROWS = 500;
function SqlCardsView({ columns, rows }: { columns: SqlColumn[]; rows: SqlRow[] }) {
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
        {capped.map((row, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card px-4 py-3 text-xs shadow-soft"
          >
            <dl className="space-y-1">
              {columns.map((col) => {
                const v = getSqlCellValue(row, col.name);
                return (
                  <div key={col.name} className="flex gap-2">
                    <dt className="w-1/3 shrink-0 truncate font-semibold text-muted-foreground">{col.name}</dt>
                    <dd className="min-w-0 flex-1 truncate text-foreground">
                      {v === null || v === undefined
                        ? <span className="italic text-muted-foreground">null</span>
                        : typeof v === 'object'
                        ? <span className="font-mono">{JSON.stringify(v)}</span>
                        : String(v)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  JSON view                                                          */
/* ------------------------------------------------------------------ */

const JSON_VIEW_MAX_ROWS = 2_000;
function JsonView({ rows }: { rows: SqlRow[] }) {
  const toast = useToast();
  const [copiedAll, setCopiedAll] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // JSON pretty-printing is O(rows × cells) and builds a single string in
  // memory. For streaming result sets we only render the first N rows so
  // this tab stays interactive; the full export lives behind the CSV /
  // NDJSON downloads.
  const capped = useMemo(
    () => (rows.length > JSON_VIEW_MAX_ROWS ? rows.slice(0, JSON_VIEW_MAX_ROWS) : rows),
    [rows],
  );
  const jsonPreviewTruncated = rows.length > capped.length;
  const json = useMemo(() => JSON.stringify(capped, null, 2), [capped]);
  const highlighted = useMemo(() => highlightJson(json), [json]);

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
          {rows.length.toLocaleString()} rows as JSON. Use Download CSV / JSON
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
        aria-label="SQL results JSON, scrollable"
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
