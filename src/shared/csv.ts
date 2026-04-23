/**
 * Tiny CSV helpers used by the results toolbar. RFC-4180 style:
 * wrap fields containing commas, quotes, or newlines in double
 * quotes and escape embedded quotes by doubling them.
 */

export function formatCellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function esc(v: unknown): string {
  const s = formatCellText(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * CSV for the Firestore ResultsTable shape. Document id/path are emitted
 * as the first two columns followed by the discovered column names.
 */
export function firestoreRowsToCsv(
  rows: Array<{ id: string; path: string; data: Record<string, unknown> }>,
  columns: readonly string[],
): string {
  const header = ['__id', '__path', ...columns].map(esc).join(',');
  const body = rows
    .map((r) =>
      [r.id, r.path, ...columns.map((c) => r.data[c])].map(esc).join(','),
    )
    .join('\n');
  return `${header}\n${body}`;
}

/**
 * CSV for the SQL results shape. Column order is dictated by the
 * driver-returned column list.
 */
export function sqlRowsToCsv(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<{ name: string }>,
): string {
  const header = columns.map((c) => esc(c.name)).join(',');
  const body = rows
    .map((r) => columns.map((c) => esc(r[c.name])).join(','))
    .join('\n');
  return `${header}\n${body}`;
}
