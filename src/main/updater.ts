import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

/**
 * Auto-update integration via `electron-updater`.
 *
 * Behavior:
 *  - Packaged builds automatically check for updates on launch and every 6 h.
 *  - Dev builds skip entirely (there's nothing to update against).
 *  - When an update finishes downloading we notify the focused window;
 *    `UpdateBanner` in the renderer shows a "Restart to update" prompt.
 *  - Users can trigger a manual check from Help → Check for Updates;
 *    we re-fire events so any open banner re-renders.
 */

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000; // 6 hours

function emit(channel: string, payload?: unknown): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) return;
  win.webContents.send(channel, payload);
}

/**
 * Wire up listeners and kick off an initial check. Safe to call only once
 * after `app.whenReady()`.
 */
export function installAutoUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => emit('updater:checking'));
  autoUpdater.on('update-available', (info) =>
    emit('updater:available', { version: info.version }),
  );
  autoUpdater.on('update-not-available', () => emit('updater:none'));
  autoUpdater.on('download-progress', (p) =>
    emit('updater:progress', { percent: p.percent }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    emit('updater:downloaded', { version: info.version }),
  );
  autoUpdater.on('error', (err) =>
    emit('updater:error', { message: err.message }),
  );

  void autoUpdater.checkForUpdates();
  setInterval(() => void autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS);
}

/**
 * Manual check triggered from Help → Check for Updates. Returns the
 * updater promise so callers can surface an error toast when the user
 * explicitly asked.
 */
export async function checkForUpdatesNow(): Promise<void> {
  if (!app.isPackaged) {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      await dialog.showMessageBox(win, {
        type: 'info',
        message: 'Auto-update is disabled in development builds.',
      });
    }
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    emit('updater:error', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Quit and install the already-downloaded update. Call this after the
 * user clicks "Restart to update" in the banner.
 */
export function installDownloadedUpdate(): void {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall();
}
