import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron';

/**
 * Native application menu.
 *
 * Electron's default menu is a generic "File > Quit / View > Reload" shell
 * that doesn't reflect anything about this app. We replace it with a menu
 * that gives users real hooks into the app: navigate to New Profile, jump
 * to History, open docs, etc. Actions fire a namespaced IPC message on
 * the focused window so the renderer can route them like any other
 * navigation event.
 */

function emit(channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) return;
  win.webContents.send(channel, ...args);
}

export function installAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Profile…',
          accelerator: 'CmdOrCtrl+N',
          click: () => emit('menu:newProfile'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [
        {
          label: 'Show History',
          accelerator: 'CmdOrCtrl+Y',
          click: () => emit('menu:navigate', 'history'),
        },
        {
          label: 'Clear History…',
          click: () => emit('menu:clearHistory'),
        },
      ],
    },
    {
      role: 'windowMenu',
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () =>
            void shell.openExternal(
              'https://github.com/rex-danquah/Firestore-Query-Studio#readme',
            ),
        },
        {
          label: 'Report an Issue',
          click: () =>
            void shell.openExternal(
              'https://github.com/rex-danquah/Firestore-Query-Studio/issues/new',
            ),
        },
        {
          label: 'Check for Updates…',
          click: () => emit('menu:checkForUpdates'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
