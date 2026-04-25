import { BrowserWindow, dialog } from 'electron';

/**
 * Native "Pick a CSV/XLSX file" dialog. Used by the renderer when creating
 * a new file-backed profile. The renderer can't use the browser's File API
 * because we need an absolute path for the main-process parser.
 */

export type PickDataFileResult =
  | { canceled: true }
  | { canceled: false; path: string; kind: 'csv' | 'xlsx' };

export async function pickDataFile(): Promise<PickDataFileResult> {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options: Electron.OpenDialogOptions = {
    title: 'Select a spreadsheet',
    properties: ['openFile'],
    filters: [
      { name: 'Spreadsheets', extensions: ['csv', 'tsv', 'xlsx', 'xls'] },
      { name: 'CSV', extensions: ['csv', 'tsv'] },
      { name: 'Excel', extensions: ['xlsx', 'xls'] },
      { name: 'All files', extensions: ['*'] },
    ],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  const path = result.filePaths[0];
  const kind = path.match(/\.(xlsx|xls)$/i) ? 'xlsx' : 'csv';
  return { canceled: false, path, kind };
}
