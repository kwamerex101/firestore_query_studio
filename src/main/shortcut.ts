import { BrowserWindow, globalShortcut } from 'electron';

/**
 * Registers a global accelerator that brings the app window to the front
 * from any other application. Default combo is `Cmd+Shift+Q` on macOS and
 * `Ctrl+Shift+Q` on Windows/Linux (`CmdOrCtrl` resolves per-platform).
 *
 * Returns `true` when the registration succeeded. The OS can refuse (e.g.
 * if another app already owns that combo); when that happens we log and
 * skip — the app still works, just without the hotkey.
 */
export const GLOBAL_SHORTCUT_ACCELERATOR = 'CmdOrCtrl+Shift+Q';

export function registerGlobalShortcut(): boolean {
  const ok = globalShortcut.register(GLOBAL_SHORTCUT_ACCELERATOR, () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  if (!ok) {
    // eslint-disable-next-line no-console
    console.warn(
      `[shortcut] Failed to register ${GLOBAL_SHORTCUT_ACCELERATOR} — another app likely owns it.`,
    );
  }
  return ok;
}

export function unregisterGlobalShortcut(): void {
  globalShortcut.unregister(GLOBAL_SHORTCUT_ACCELERATOR);
}
