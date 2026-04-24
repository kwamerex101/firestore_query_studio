import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';

/**
 * Menu-bar / system-tray icon. Keeps the app one click away when the main
 * window is hidden. The tray icon itself is a 16x16 PNG bundled from
 * `renderer/public` — same art as the PWA favicon so desktop + web read
 * as the same product.
 */

let tray: Tray | null = null;

function trayIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar.unpacked', 'icon-16.png');
  }
  return join(app.getAppPath(), 'src/renderer/public/icon-16.png');
}

function focusWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function hideWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  win?.hide();
}

function rebuildMenu(): void {
  if (!tray) return;
  const win = BrowserWindow.getAllWindows()[0];
  const visible = win?.isVisible() ?? false;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: visible ? 'Hide Firestore Query Studio' : 'Show Firestore Query Studio',
        click: () => (visible ? hideWindow() : focusWindow()),
      },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ]),
  );
}

/**
 * Build the tray. Safe to call after `app.whenReady()`. Returns `null` on
 * platforms that don't support a tray icon (or when the PNG can't be
 * loaded — dev first-runs before icons are generated, for example).
 */
export function installTray(): Tray | null {
  try {
    const img = nativeImage.createFromPath(trayIconPath());
    if (img.isEmpty()) {
      // eslint-disable-next-line no-console
      console.warn('[tray] icon asset missing, skipping tray install');
      return null;
    }
    // macOS menu-bar icons render best as 16x16 templates; resizing in place
    // lets us reuse the same art we ship for the PWA.
    const sized = img.resize({ width: 16, height: 16 });
    tray = new Tray(sized);
    tray.setToolTip('Firestore Query Studio');
    tray.on('click', () => focusWindow());
    rebuildMenu();

    // Keep the "Show/Hide" label in sync with the window's actual state.
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.on('show', rebuildMenu);
      win.on('hide', rebuildMenu);
      win.on('minimize', rebuildMenu);
      win.on('restore', rebuildMenu);
    }
    return tray;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[tray] install failed', err);
    return null;
  }
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
