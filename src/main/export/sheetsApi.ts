import { google } from 'googleapis';
import {
  clientFromStoredTokens,
  type SheetsTokens,
} from './sheetsAuth';

/**
 * Thin wrapper around Sheets API v4. Two operations are exposed:
 *
 *   - `createSpreadsheet`: creates a fresh untitled spreadsheet, writes a
 *     header row + data starting at A1, returns the spreadsheet URL.
 *   - `appendToSpreadsheet`: accepts a spreadsheet id (or URL to extract
 *     the id from) + optional sheet name and appends rows below the
 *     existing data using `values.append` with `valueInputOption: RAW`.
 */

export interface SheetsExportInput {
  clientId: string;
  clientSecret: string;
  tokens: SheetsTokens;
  /** Title for a newly-created spreadsheet. */
  title?: string;
  /** Column header row. */
  columns: string[];
  /** 2D matrix of cell values. Non-primitives are JSON.stringify'd. */
  rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

export interface CreateOutcome {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheetTitle: string;
  rowCount: number;
}

export interface AppendInput extends SheetsExportInput {
  /** Either a spreadsheetId or a full /spreadsheets/d/<id>/ URL. */
  spreadsheetRef: string;
  /** Optional sheet tab name; defaults to the first tab. */
  sheetName?: string;
}

export interface AppendOutcome {
  spreadsheetId: string;
  spreadsheetUrl: string;
  appendedRange: string;
  rowCount: number;
}

function normalizeCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toValueMatrix(
  columns: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): Array<Array<string | number | boolean>> {
  const matrix: Array<Array<string | number | boolean>> = [columns.slice()];
  for (const row of rows) matrix.push(row.map(normalizeCell));
  return matrix;
}

function extractSpreadsheetId(ref: string): string {
  const m = ref.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  // Accept a bare id too. Sheets spreadsheet ids are typically 44 chars of
  // [a-zA-Z0-9_-]; we don't validate strictly here because Google returns
  // a clear 404 for garbage ids.
  return ref.trim();
}

export async function createSpreadsheet(
  input: SheetsExportInput,
): Promise<CreateOutcome> {
  const auth = clientFromStoredTokens(input);
  const sheets = google.sheets({ version: 'v4', auth });
  const title = input.title?.trim() || `Firestore Query Studio export ${new Date().toISOString()}`;

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{ properties: { title: 'Results' } }],
    },
  });

  const spreadsheetId = created.data.spreadsheetId ?? '';
  const spreadsheetUrl =
    created.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  const values = toValueMatrix(input.columns, input.rows);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Results!A1',
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  return {
    spreadsheetId,
    spreadsheetUrl,
    sheetTitle: 'Results',
    rowCount: values.length - 1, // exclude header
  };
}

export async function appendToSpreadsheet(
  input: AppendInput,
): Promise<AppendOutcome> {
  const auth = clientFromStoredTokens(input);
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = extractSpreadsheetId(input.spreadsheetRef);
  if (!spreadsheetId) throw new Error('Spreadsheet id or URL is required.');

  const sheetName = input.sheetName?.trim() || 'Sheet1';
  const range = `${sheetName}!A1`;
  const values = toValueMatrix(input.columns, input.rows);

  const appended = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    appendedRange: appended.data.updates?.updatedRange ?? range,
    rowCount: values.length - 1,
  };
}
