import {
  CursorSettings,
  LlmProvider,
  LlmSettings,
} from '@shared/types/profile';
import type {
  CursorGetResult,
  LlmGetResult,
  LlmWarmupOutcome,
  ProviderResult,
} from '@shared/types/ipc';
import { openaiChat } from '@shared/planner';
import { getDb, SettingsKeys } from './db';
import { decryptString, encryptString, isEncryptedBlob } from './crypto';

/**
 * Settings storage for the web transport. The API key is encrypted with a
 * non-extractable AES-GCM key kept in IndexedDB (see `crypto.ts`); the rest
 * of the LLM config is stored in plaintext because it contains nothing
 * sensitive beyond what the user typed into the settings form.
 */

type StoredLlmSettings = Omit<LlmSettings, 'apiKey'> & {
  apiKey?: unknown; // EncryptedBlob | string | undefined
};

async function readLlm(): Promise<LlmSettings | null> {
  const db = await getDb();
  const raw = (await db.get('settings', SettingsKeys.llmSettings)) as
    | StoredLlmSettings
    | undefined;
  if (!raw) return null;
  let apiKey: string | undefined;
  if (isEncryptedBlob(raw.apiKey)) {
    try {
      apiKey = await decryptString(raw.apiKey);
    } catch {
      // If decryption fails (e.g. the device key was regenerated), strip
      // the key rather than crashing — the user will be prompted to paste
      // it again. This is safer than hanging on every renderer bootstrap.
      apiKey = undefined;
    }
  } else if (typeof raw.apiKey === 'string') {
    apiKey = raw.apiKey;
  }
  return LlmSettings.parse({
    baseUrl: raw.baseUrl,
    model: raw.model,
    timeoutMs: raw.timeoutMs,
    ...(apiKey ? { apiKey } : {}),
  });
}

export async function llmGet(): Promise<LlmGetResult> {
  const existing = await readLlm();
  if (!existing) return { hasApiKey: false };
  const { apiKey, ...rest } = existing;
  return {
    ...rest,
    hasApiKey: Boolean(apiKey && apiKey.length > 0),
  };
}

export async function llmSet(input: LlmSettings): Promise<LlmGetResult> {
  const parsed = LlmSettings.parse(input);
  const stored: StoredLlmSettings = {
    baseUrl: parsed.baseUrl,
    model: parsed.model,
    timeoutMs: parsed.timeoutMs,
  };
  if (parsed.apiKey && parsed.apiKey.length > 0) {
    stored.apiKey = await encryptString(parsed.apiKey);
  }
  const db = await getDb();
  await db.put(
    'settings',
    stored as unknown as never,
    SettingsKeys.llmSettings,
  );
  return llmGet();
}

/**
 * Full settings including the plaintext apiKey. Only the planner/insights
 * modules should use this; renderer UI should always consume `llmGet`.
 */
export async function getLlmSettingsForCall(): Promise<LlmSettings | null> {
  return readLlm();
}

export async function llmWarmup(): Promise<LlmWarmupOutcome> {
  const started = Date.now();
  const settings = await readLlm();
  if (!settings || !settings.apiKey) {
    return {
      ok: false,
      code: 'LLM_NOT_CONFIGURED',
      message:
        'Configure an LLM base URL and API key before running a warmup.',
      elapsedMs: Date.now() - started,
    };
  }
  // The shared openai chat module already retries on 5xx / timeouts, so a
  // single round-trip with a trivial prompt is a good smoke-test.
  try {
    const res = await openaiChat(
      {
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
      },
      [{ role: 'user', content: 'ok' }],
      { temperature: 0, timeoutMs: Math.min(settings.timeoutMs, 15_000), retries: 0 },
    );
    return {
      ok: true,
      elapsedMs: Date.now() - started,
      model: res.model,
    };
  } catch (err) {
    return {
      ok: false,
      code:
        (err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : null) ?? 'UNEXPECTED',
      message: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    };
  }
}

export async function providerGet(): Promise<ProviderResult> {
  const db = await getDb();
  const raw = (await db.get('settings', SettingsKeys.llmProvider)) as
    | string
    | undefined;
  // The Cursor CLI is hidden on web (see `capabilities.cursorCli`), so if
  // an imported record contains it, silently fall back to openai-compat
  // rather than surfacing an unusable option.
  if (raw === 'openai-compat' || raw === 'cursor-cli') {
    return { provider: raw === 'cursor-cli' ? 'openai-compat' : raw };
  }
  return { provider: 'openai-compat' };
}

export async function providerSet(input: {
  provider: LlmProvider;
}): Promise<ProviderResult> {
  const db = await getDb();
  // Reject the Cursor CLI provider on web — there's no subprocess to spawn.
  // The UI shouldn't expose this option, but double-check at the boundary.
  const provider: LlmProvider =
    input.provider === 'cursor-cli' ? 'openai-compat' : input.provider;
  await db.put(
    'settings',
    provider as unknown as never,
    SettingsKeys.llmProvider,
  );
  return { provider };
}

// Cursor CLI is never configured on web; these stubs exist only because the
// renderer currently probes for them regardless of capability. See
// `capabilities.ts` / the forthcoming UI pass that hides the Cursor tab.

export async function cursorGet(): Promise<CursorGetResult> {
  return { isConfigured: false };
}

export async function cursorSet(_: CursorSettings): Promise<CursorGetResult> {
  throw new Error(
    'The Cursor CLI provider is only available in the desktop app. Use an OpenAI-compatible endpoint in the web build.',
  );
}
