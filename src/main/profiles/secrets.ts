import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  LlmSettings,
  CursorSettings,
  LlmProvider,
} from '@shared/types/profile';

const SECRETS_FILENAME = 'secrets.bin';
const PLAIN_FALLBACK_FILENAME = 'secrets.plain.json';

type SecretsShape = {
  llm?: LlmSettings;
  cursor?: CursorSettings;
  provider?: LlmProvider;
};

/**
 * Wrapper around Electron's safeStorage. Falls back to a plain (warned) file
 * only when safeStorage reports encryption is not available (e.g. on Linux
 * without libsecret and keytar also unavailable). In that case we still
 * chmod 0600 the file.
 */

function secretsDir(): string {
  return app.getPath('userData');
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(secretsDir(), { recursive: true });
}

function encryptedPath(): string {
  return join(secretsDir(), SECRETS_FILENAME);
}
function fallbackPath(): string {
  return join(secretsDir(), PLAIN_FALLBACK_FILENAME);
}

async function readRaw(): Promise<SecretsShape> {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = await fs.readFile(encryptedPath());
      const decrypted = safeStorage.decryptString(buf);
      return JSON.parse(decrypted) as SecretsShape;
    }
    const raw = await fs.readFile(fallbackPath(), 'utf8');
    return JSON.parse(raw) as SecretsShape;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    throw err;
  }
}

async function writeRaw(data: SecretsShape): Promise<void> {
  await ensureDir();
  const json = JSON.stringify(data);
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json);
    await fs.writeFile(encryptedPath(), encrypted, { mode: 0o600 });
    return;
  }
  await fs.writeFile(fallbackPath(), json, { mode: 0o600 });
}

export async function getLlmSettings(): Promise<LlmSettings | null> {
  const data = await readRaw();
  return data.llm ?? null;
}

export async function setLlmSettings(settings: LlmSettings): Promise<LlmSettings> {
  const parsed = LlmSettings.parse(settings);
  const data = await readRaw();
  data.llm = parsed;
  await writeRaw(data);
  return parsed;
}

export async function clearLlmSettings(): Promise<void> {
  const data = await readRaw();
  delete data.llm;
  await writeRaw(data);
}

export async function getCursorSettings(): Promise<CursorSettings | null> {
  const data = await readRaw();
  if (!data.cursor) return null;
  // Re-parse to apply defaults for any fields missing from earlier writes.
  const parsed = CursorSettings.safeParse(data.cursor);
  return parsed.success ? parsed.data : null;
}

export async function setCursorSettings(settings: CursorSettings): Promise<CursorSettings> {
  const parsed = CursorSettings.parse(settings);
  const data = await readRaw();
  data.cursor = parsed;
  await writeRaw(data);
  return parsed;
}

export async function clearCursorSettings(): Promise<void> {
  const data = await readRaw();
  delete data.cursor;
  await writeRaw(data);
}

export async function getActiveProvider(): Promise<LlmProvider> {
  const data = await readRaw();
  const parsed = LlmProvider.safeParse(data.provider);
  return parsed.success ? parsed.data : 'openai-compat';
}

export async function setActiveProvider(provider: LlmProvider): Promise<LlmProvider> {
  const parsed = LlmProvider.parse(provider);
  const data = await readRaw();
  data.provider = parsed;
  await writeRaw(data);
  return parsed;
}
