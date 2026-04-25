import { createReadStream, promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { app } from 'electron';
import type { FileProfileKind } from '@shared/types/profile';

/**
 * Parse a CSV or XLSX file into one or more SQLite tables.
 *
 * Responsibilities:
 *  - Inspect the file and split it into `{ tableName, columns, rows }` units.
 *    CSV → one table named after the filename. XLSX → one table per sheet.
 *  - Infer column types with a lightweight heuristic (first N rows): INTEGER,
 *    REAL, TEXT. BOOLEANs stay TEXT since SQLite has no boolean class.
 *  - Write rows into a SQLite database at `<userData>/file-profiles/<profileId>.sqlite`.
 *
 * The SQLite file is self-contained, so a profile survives the source file
 * being moved/deleted after import. Users who want fresh data click
 * "Refresh" which re-runs this routine against the original `sourcePath`.
 */

export interface ParsedTable {
  tableName: string;
  columns: Array<{ name: string; affinity: 'INTEGER' | 'REAL' | 'TEXT' }>;
  rows: Array<Array<string | number | null>>;
}

export interface ImportResult {
  /** Absolute path to the materialized .sqlite file. */
  sqlitePath: string;
  /** Tables written, in insertion order. */
  tables: string[];
  /** Approximate row counts per table, as of import time. */
  rowCounts: Record<string, number>;
  /** Size of the source file in bytes. */
  sizeBytes: number;
}

const SAMPLE_ROWS_FOR_TYPE_INFERENCE = 100;
const SAFE_TABLE_NAME_RE = /[^A-Za-z0-9_]+/g;

function safeIdent(raw: string, fallback: string): string {
  const cleaned = raw.replace(SAFE_TABLE_NAME_RE, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback;
  // SQLite identifiers can't start with a digit unless quoted; prepend `t_`
  // so users can write the bare name in SQL.
  return /^\d/.test(cleaned) ? `t_${cleaned}` : cleaned;
}

function inferAffinity(
  samples: Array<string | number | null>,
): 'INTEGER' | 'REAL' | 'TEXT' {
  let sawText = false;
  let sawReal = false;
  let sawAny = false;
  for (const v of samples) {
    if (v === null || v === undefined) continue;
    sawAny = true;
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) sawReal = true;
      continue;
    }
    const s = String(v).trim();
    if (!s) continue;
    if (/^-?\d+$/.test(s)) continue; // integer-looking string
    if (/^-?\d+\.\d+$/.test(s) || /^-?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(s)) {
      sawReal = true;
      continue;
    }
    sawText = true;
    break;
  }
  if (!sawAny) return 'TEXT';
  if (sawText) return 'TEXT';
  return sawReal ? 'REAL' : 'INTEGER';
}

function coerceCell(
  raw: unknown,
  affinity: 'INTEGER' | 'REAL' | 'TEXT',
): string | number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return raw;
  }
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (raw instanceof Date) return raw.toISOString();
  const s = String(raw);
  if (!s) return null;
  if (affinity === 'TEXT') return s;
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return affinity === 'INTEGER' ? Math.trunc(n) : n;
}

async function parseCsv(sourcePath: string): Promise<ParsedTable[]> {
  // `papaparse` exposes either `Papa.parse` (when electron-vite transpiles
  // to CJS) or `(Papa as { default: typeof Papa }).default.parse` (ESM
  // interop). Both shapes appear depending on the build; prefer the former
  // and fall back to the latter without tripping TypeScript's default-
  // import inference.
  const Papa = await import('papaparse');
  const parseFn: typeof import('papaparse').parse =
    (Papa as unknown as { parse?: typeof import('papaparse').parse }).parse ??
    (Papa as unknown as { default: { parse: typeof import('papaparse').parse } }).default
      .parse;

  return new Promise<ParsedTable[]>((resolve, reject) => {
    const rows: Array<Record<string, unknown>> = [];
    parseFn(createReadStream(sourcePath, { encoding: 'utf8' }) as unknown as NodeJS.ReadableStream, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      worker: false,
      step: (result) => {
        rows.push(result.data as Record<string, unknown>);
      },
      complete: () => {
        try {
          resolve([buildTableFromRows(basename(sourcePath, extOf(sourcePath)), rows)]);
        } catch (err) {
          reject(err);
        }
      },
      error: (err: Error) => reject(err),
    });
  });
}

function extOf(path: string): string {
  const m = path.match(/(\.[^.\\/]+)$/);
  return m ? m[1] : '';
}

async function parseXlsx(sourcePath: string): Promise<ParsedTable[]> {
  const XLSX = await import('xlsx');
  const buf = await fs.readFile(sourcePath);
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const tables: ParsedTable[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    // `defval: null` so missing cells become null (not empty string).
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Array<Record<string, unknown>>;
    if (raw.length === 0) continue;
    tables.push(buildTableFromRows(sheetName, raw));
  }
  return tables;
}

function buildTableFromRows(
  rawName: string,
  rawRows: Array<Record<string, unknown>>,
): ParsedTable {
  const tableName = safeIdent(rawName, 'data');
  // Collect union of keys, preserving first-seen order.
  const columnOrder: string[] = [];
  const columnSet = new Set<string>();
  for (const row of rawRows) {
    for (const key of Object.keys(row)) {
      if (columnSet.has(key)) continue;
      columnSet.add(key);
      columnOrder.push(key);
    }
  }

  const columnNames = columnOrder.map((k) => safeIdent(k, 'col'));
  const sampleMatrix: Array<Array<string | number | null>> = [];
  for (let i = 0; i < Math.min(rawRows.length, SAMPLE_ROWS_FOR_TYPE_INFERENCE); i += 1) {
    const row = rawRows[i];
    sampleMatrix.push(
      columnOrder.map((key) => normalizeCellForSample(row[key])),
    );
  }

  const columns = columnNames.map((name, idx) => ({
    name,
    affinity: inferAffinity(sampleMatrix.map((r) => r[idx])),
  }));

  const rows: Array<Array<string | number | null>> = rawRows.map((row) =>
    columnOrder.map((key, idx) => coerceCell(row[key], columns[idx].affinity)),
  );

  return { tableName, columns, rows };
}

function normalizeCellForSample(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function userFileProfilesDir(): string {
  return join(app.getPath('userData'), 'file-profiles');
}

export function sqlitePathForProfile(profileId: string): string {
  return join(userFileProfilesDir(), `${profileId}.sqlite`);
}

/**
 * Parse a CSV/XLSX file, write it to SQLite, and return the file metadata
 * needed to build a `FileProfile`. The caller supplies the profile id.
 */
export async function importFileToSqlite(args: {
  profileId: string;
  kind: FileProfileKind;
  sourcePath: string;
}): Promise<ImportResult> {
  const { profileId, kind, sourcePath } = args;
  const sqlitePath = sqlitePathForProfile(profileId);
  await fs.mkdir(userFileProfilesDir(), { recursive: true });
  // Blow away any prior database for this profile id so re-imports are
  // clean.
  try {
    await fs.unlink(sqlitePath);
  } catch {
    /* no-op if it wasn't there */
  }

  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${sourcePath}`);
  }

  const tables = kind === 'csv' ? await parseCsv(sourcePath) : await parseXlsx(sourcePath);
  if (tables.length === 0) {
    throw new Error('The file did not contain any readable rows.');
  }

  // Open the target db and write. We import better-sqlite3 dynamically so
  // the native addon only loads in Electron's main process — the renderer
  // typecheck path stays addon-free.
  const BetterSqlite = (await import('better-sqlite3')).default;
  const db = new BetterSqlite(sqlitePath);
  db.pragma('journal_mode = WAL');

  const rowCounts: Record<string, number> = {};
  const tableNames: string[] = [];
  const tx = db.transaction((all: ParsedTable[]) => {
    for (const table of all) {
      // Avoid clashing table names by appending a suffix when necessary.
      let finalName = table.tableName;
      let suffix = 1;
      while (tableNames.includes(finalName)) {
        suffix += 1;
        finalName = `${table.tableName}_${suffix}`;
      }
      tableNames.push(finalName);

      const columnDdl = table.columns
        .map((c) => `"${c.name}" ${c.affinity}`)
        .join(', ');
      db.prepare(`DROP TABLE IF EXISTS "${finalName}"`).run();
      db.prepare(`CREATE TABLE "${finalName}" (${columnDdl})`).run();

      if (table.rows.length === 0) {
        rowCounts[finalName] = 0;
        continue;
      }
      const placeholders = table.columns.map(() => '?').join(', ');
      const insert = db.prepare(
        `INSERT INTO "${finalName}" (${table.columns
          .map((c) => `"${c.name}"`)
          .join(', ')}) VALUES (${placeholders})`,
      );
      for (const row of table.rows) insert.run(row);
      rowCounts[finalName] = table.rows.length;
    }
  });
  tx(tables);
  db.close();

  return {
    sqlitePath,
    tables: tableNames,
    rowCounts,
    sizeBytes: stat.size,
  };
}
