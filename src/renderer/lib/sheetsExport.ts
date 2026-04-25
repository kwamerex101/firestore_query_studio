/**
 * Zero-auth path for getting results into Google Sheets.
 *
 * Two complementary flows live here:
 *
 * 1. **TSV + sheets.new** (this file's original scope). No OAuth — just
 *    copy the full result as TSV, open a new Sheet, and have the user
 *    paste. Works in Electron and the web build.
 *
 * 2. **Full Sheets API v4 export** via `exportToSheetsApi` below. Requires
 *    the user to connect in Settings → Google Sheets first. When
 *    connected, the results toolbar can call straight into
 *    `ipc.sheets.exportCreate` (new untitled sheet) or
 *    `ipc.sheets.exportAppend` (append to an existing spreadsheet by
 *    URL / id).
 */

type ToastPush = (msg: string, tone?: 'success' | 'error' | 'info') => void;

const SHEETS_NEW_URL = 'https://sheets.new';

export async function copyTsvAndOpenSheets(
  tsv: string,
  toast: { push: ToastPush },
): Promise<void> {
  try {
    await navigator.clipboard.writeText(tsv);
  } catch (err) {
    toast.push(
      `Clipboard write failed: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
    return;
  }
  // Small UX delay: the user needs to read the toast before the browser
  // steals focus. The shell.openExternal / window.open call happens on
  // the next tick so React can flush the success toast first.
  toast.push('Copied as TSV. Paste into the new sheet with ⌘V / Ctrl-V.', 'success');
  window.setTimeout(() => {
    try {
      window.open(SHEETS_NEW_URL, '_blank', 'noopener,noreferrer');
    } catch {
      /* Popup blocked — the clipboard write already succeeded, so the
         user can navigate to sheets.new manually. */
    }
  }, 200);
}

/**
 * Normalize an unknown cell value to a primitive that survives IPC
 * serialization into the Sheets API. Mirrors the main-process
 * `normalizeCell` helper — the two need to agree on null/object handling.
 */
export function toSheetsCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Build a 2D matrix of primitives ready for the Sheets export IPC.
 * Each row is aligned to `columns`: missing keys become null.
 */
export function toSheetsMatrix(
  columns: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
): Array<Array<string | number | boolean | null>> {
  return rows.map((row) => columns.map((c) => toSheetsCell(row[c])));
}
