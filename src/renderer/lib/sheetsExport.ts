/**
 * Zero-auth path for getting results into Google Sheets.
 *
 * Rather than building a full OAuth + Sheets API v4 export (which requires
 * provisioning Google Cloud credentials, running a local redirect server
 * in Electron, and persistent token storage), we use the fact that
 * Google Sheets' paste handler recognizes TSV and splits into columns.
 *
 *  1. Copy TSV (tab-separated) to the clipboard.
 *  2. Open `sheets.new` which creates a brand-new untitled Sheet.
 *  3. Prompt the user to paste (⌘V / Ctrl-V) into A1.
 *
 * Works identically in Electron (opens via shell.openExternal → default
 * browser) and the web build (target=_blank). No secrets, no OAuth
 * consent screen, no refresh-token plumbing.
 *
 * If the user later needs scripted exports (append to existing sheet,
 * schedule on a cron), a full Sheets API integration can layer on top of
 * this without displacing the no-auth flow that covers the 80% case.
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
