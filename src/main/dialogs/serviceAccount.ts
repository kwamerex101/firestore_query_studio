import { app, BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { loadServiceAccount } from '../firestore/adminClient';

const IMPORT_SUBDIR = 'service-accounts';

export type PickServiceAccountResult =
  | { canceled: true }
  | { canceled: false; path: string };

export type ValidateServiceAccountRequest = { path: string };

export type ValidateServiceAccountResult =
  | {
      ok: true;
      path: string;
      projectId: string;
      clientEmail: string;
      sizeBytes: number;
    }
  | {
      ok: false;
      path: string;
      code: 'NOT_FOUND' | 'TOO_LARGE' | 'INVALID_JSON' | 'MISSING_FIELDS' | 'UNKNOWN';
      message: string;
    };

export type ImportServiceAccountRequest = { path: string; profileId: string };

export type ImportServiceAccountResult = { path: string };

const MAX_BYTES = 32 * 1024;

export function importedServiceAccountDir(): string {
  return join(app.getPath('userData'), IMPORT_SUBDIR);
}

/**
 * True if `candidate` lives under the app's managed service-accounts dir.
 * Used by profile-delete cleanup to avoid ever removing user-chosen paths.
 */
export function isImportedServiceAccountPath(candidate: string): boolean {
  const root = normalize(importedServiceAccountDir()) + sep;
  const normalized = normalize(candidate);
  return normalized.startsWith(root);
}

export async function pickServiceAccount(): Promise<PickServiceAccountResult> {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options: Electron.OpenDialogOptions = {
    title: 'Select service-account JSON',
    properties: ['openFile'],
    filters: [
      { name: 'Service account JSON', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] },
    ],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  return { canceled: false, path: result.filePaths[0] };
}

export async function validateServiceAccount(
  req: ValidateServiceAccountRequest,
): Promise<ValidateServiceAccountResult> {
  const { path } = req;
  let stat;
  try {
    stat = await fs.stat(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, path, code: 'NOT_FOUND', message: `File not found: ${path}` };
    }
    return {
      ok: false,
      path,
      code: 'UNKNOWN',
      message: (err as Error).message || 'Could not read file.',
    };
  }
  if (stat.size > MAX_BYTES) {
    return {
      ok: false,
      path,
      code: 'TOO_LARGE',
      message: `File is ${stat.size} bytes; expected a service-account JSON under ${MAX_BYTES} bytes.`,
    };
  }
  try {
    const creds = await loadServiceAccount(path);
    return {
      ok: true,
      path,
      projectId: creds.projectId as string,
      clientEmail: creds.clientEmail as string,
      sizeBytes: stat.size,
    };
  } catch (err) {
    const message = (err as Error).message || 'Failed to parse service-account JSON.';
    const code = /not valid JSON/i.test(message)
      ? 'INVALID_JSON'
      : /missing one of/i.test(message)
        ? 'MISSING_FIELDS'
        : 'UNKNOWN';
    return { ok: false, path, code, message };
  }
}

export async function importServiceAccount(
  req: ImportServiceAccountRequest,
): Promise<ImportServiceAccountResult> {
  const { path: source, profileId } = req;
  if (!profileId) throw new Error('importServiceAccount requires a profileId.');
  // Validate first so we never copy a file that cannot be used to connect.
  const check = await validateServiceAccount({ path: source });
  if (!check.ok) {
    throw new Error(`Cannot import service-account JSON: ${check.message}`);
  }
  const dir = importedServiceAccountDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, `${profileId}.json`);
  // `copyFile` overwrites by default, which is what we want: re-importing
  // should replace the previous copy atomically from the user's perspective.
  await fs.copyFile(source, target);
  await fs.chmod(target, 0o600);
  return { path: target };
}

export async function removeImportedServiceAccount(path: string): Promise<void> {
  if (!isImportedServiceAccountPath(path)) return;
  await fs.rm(path, { force: true });
}
