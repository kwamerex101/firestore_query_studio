import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { registerIpcHandlers } from './ipc/router';
import { disposeCurrent } from './firestore/connectionManager';
import { installAppMenu } from './menu';
import { installTray, destroyTray } from './tray';
import {
  registerGlobalShortcut,
  unregisterGlobalShortcut,
} from './shortcut';
import {
  installAutoUpdater,
  checkForUpdatesNow,
  installDownloadedUpdate,
} from './updater';

const isDev = !app.isPackaged;

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Firestore Query Studio',
    backgroundColor: '#0b0f19',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  installAppMenu();
  await createWindow();
  installTray();
  registerGlobalShortcut();
  installAutoUpdater();

  ipcMain.on('updater:checkNow', () => void checkForUpdatesNow());
  ipcMain.on('updater:installNow', () => installDownloadedUpdate());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', async () => {
  await disposeCurrent();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', async () => {
  unregisterGlobalShortcut();
  destroyTray();
  await disposeCurrent();
});
