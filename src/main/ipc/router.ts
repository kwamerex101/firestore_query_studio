import { ipcMain } from 'electron';
import type { z } from 'zod';
import { ipcApi, type IpcChannel } from '@shared/ipc-api';
import { IpcChannels } from '@shared/types/ipc';
import {
  createProfile,
  deleteProfile,
  getActiveProfileId,
  listProfiles,
  setActiveProfileId,
  updateProfile,
} from '../profiles/profileStore';
import {
  getLlmSettings,
  setLlmSettings,
  getCursorSettings,
  setCursorSettings,
  getActiveProvider,
  setActiveProvider,
} from '../profiles/secrets';
import {
  getHandleForActive,
  onProfileChanged,
} from '../firestore/connectionManager';
import { sampleCollection } from '../firestore/schemaSampler';
import {
  ensureSchema,
  getCachedSchema,
  setCachedSchema,
} from '../firestore/schemaCache';
import { runPlan } from '../firestore/executor';
import { buildPlan } from '../llm/planner';
import { getProfile } from '../profiles/profileStore';
import { chat, LlmError } from '../llm/openaiCompat';
import { listCursorModels, testCursorCli } from '../llm/cursorCli';
import {
  addHistoryEntry,
  clearHistory,
  findCachedEntry,
  getHistoryEntry,
  listHistory,
} from '../history/historyStore';
import { generateInsights } from '../llm/insights';

type Handler<C extends IpcChannel> = (
  req: z.infer<(typeof ipcApi)[C]['request']>,
) => Promise<z.infer<(typeof ipcApi)[C]['response']>>;

function register<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, async (_event, payload: unknown) => {
    const requestSchema = ipcApi[channel].request;
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        `Invalid IPC request for ${channel}: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
      );
    }
    return handler(parsed.data as never);
  });
}

export function registerIpcHandlers(): void {
  register(IpcChannels.profilesList, async () => {
    return listProfiles();
  });

  register(IpcChannels.profilesCreate, async (input) => {
    return createProfile(input);
  });

  register(IpcChannels.profilesUpdate, async ({ id, update }) => {
    const next = await updateProfile(id, update);
    const activeId = await getActiveProfileId();
    if (activeId === id) await onProfileChanged();
    return next;
  });

  register(IpcChannels.profilesDelete, async ({ id }) => {
    await deleteProfile(id);
    await onProfileChanged();
    return { ok: true as const };
  });

  register(IpcChannels.profilesSetActive, async ({ profileId }) => {
    await setActiveProfileId(profileId);
    await onProfileChanged();
    return { profileId };
  });

  register(IpcChannels.profilesGetActive, async () => {
    const profileId = await getActiveProfileId();
    return { profileId };
  });

  register(IpcChannels.llmGet, async () => {
    const s = await getLlmSettings();
    if (!s) return { hasApiKey: false };
    return {
      baseUrl: s.baseUrl,
      model: s.model,
      timeoutMs: s.timeoutMs ?? 30_000,
      hasApiKey: Boolean(s.apiKey),
    };
  });

  register(IpcChannels.llmSet, async (input) => {
    const saved = await setLlmSettings(input);
    return {
      baseUrl: saved.baseUrl,
      model: saved.model,
      timeoutMs: saved.timeoutMs ?? 30_000,
      hasApiKey: Boolean(saved.apiKey),
    };
  });

  register(IpcChannels.llmWarmup, async () => {
    const started = Date.now();
    const s = await getLlmSettings();
    if (!s || !s.apiKey) {
      return {
        ok: false as const,
        code: 'LLM_NOT_CONFIGURED',
        message: 'Configure an LLM base URL and API key before warming up.',
        elapsedMs: 0,
      };
    }
    try {
      // A tiny prompt to force the model into memory (Ollama/LM Studio cold start).
      await chat(s, {
        messages: [
          { role: 'system', content: 'Reply with a single word.' },
          { role: 'user', content: 'ping' },
        ],
        temperature: 0,
        maxOutputTokens: 4,
        timeoutMs: Math.max(s.timeoutMs ?? 30_000, 60_000),
        retries: 0,
      });
      return {
        ok: true as const,
        elapsedMs: Date.now() - started,
        model: s.model,
      };
    } catch (err) {
      const code = err instanceof LlmError ? err.code : 'UNKNOWN';
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false as const,
        code,
        message,
        elapsedMs: Date.now() - started,
      };
    }
  });

  register(IpcChannels.cursorGet, async () => {
    const s = await getCursorSettings();
    if (!s) return { isConfigured: false };
    return {
      isConfigured: true,
      command: s.command,
      model: s.model,
      mode: s.mode,
      extraArgs: s.extraArgs,
      cwd: s.cwd,
      envVars: s.envVars,
      timeoutMs: s.timeoutMs,
    };
  });

  register(IpcChannels.cursorSet, async (input) => {
    const saved = await setCursorSettings(input);
    return {
      isConfigured: true,
      command: saved.command,
      model: saved.model,
      mode: saved.mode,
      extraArgs: saved.extraArgs,
      cwd: saved.cwd,
      envVars: saved.envVars,
      timeoutMs: saved.timeoutMs,
    };
  });

  register(IpcChannels.cursorListModels, async () => {
    const s = await getCursorSettings();
    if (!s) {
      return { source: 'fallback' as const, models: [] };
    }
    return listCursorModels(s);
  });

  register(IpcChannels.cursorTest, async (input) => {
    const effective = input ?? (await getCursorSettings());
    if (!effective) {
      return {
        ok: false as const,
        code: 'NOT_CONFIGURED',
        message: 'Configure the Cursor CLI before running a test.',
      };
    }
    return testCursorCli(effective);
  });

  register(IpcChannels.providerGet, async () => {
    const provider = await getActiveProvider();
    return { provider };
  });

  register(IpcChannels.providerSet, async ({ provider }) => {
    const saved = await setActiveProvider(provider);
    return { provider: saved };
  });

  register(IpcChannels.schemaSample, async ({ collection, collectionGroup, sampleSize }) => {
    const handle = await getHandleForActive();
    const activeProfile = await getProfile(handle.profileId);
    const effectiveSize = sampleSize ?? activeProfile?.sampleSize ?? 10;
    const schema = await sampleCollection({
      firestore: handle.firestore,
      collection,
      collectionGroup,
      sampleSize: effectiveSize,
    });
    const existing = await getCachedSchema(handle.profileId, collection, collectionGroup);
    const merged = existing?.userOverride
      ? { ...schema, userOverride: existing.userOverride, userNotes: existing.userNotes }
      : schema;
    await setCachedSchema(handle.profileId, merged);
    return merged;
  });

  register(IpcChannels.schemaGet, async ({ collection, collectionGroup }) => {
    const activeId = await getActiveProfileId();
    if (!activeId) return null;
    return getCachedSchema(activeId, collection, collectionGroup);
  });

  register(IpcChannels.schemaSaveOverride, async ({ collection, collectionGroup, userOverride, userNotes }) => {
    const activeId = await getActiveProfileId();
    if (!activeId) throw new Error('No active profile.');
    const existing = (await getCachedSchema(activeId, collection, collectionGroup)) ?? {
      collection,
      collectionGroup,
      sampledCount: 0,
      sampledAt: Date.now(),
      fields: [],
    };
    const updated = {
      ...existing,
      userOverride,
      userNotes,
    };
    await setCachedSchema(activeId, updated);
    return updated;
  });

  register(IpcChannels.planBuild, async (input) => {
    const provider = await getActiveProvider();
    const settings = await getLlmSettings();
    const cursorSettings = await getCursorSettings();

    if (provider === 'openai-compat' && (!settings || !settings.apiKey)) {
      return {
        ok: false,
        code: 'LLM_NOT_CONFIGURED',
        message:
          'Configure an LLM base URL and API key in Settings, or switch to the Cursor CLI provider.',
      };
    }
    if (provider === 'cursor-cli' && !cursorSettings) {
      return {
        ok: false,
        code: 'CURSOR_NOT_CONFIGURED',
        message:
          'Configure the Cursor CLI in the Cursor tab, or switch back to an OpenAI-compatible endpoint in Settings.',
      };
    }

    // Auto-sample the target collection so the LLM always sees real
    // field types + examples. Without this, ambiguous fields like
    // `createdAt` would be treated as strings and Firestore would
    // silently return zero rows for range filters.
    let schema = null;
    if (input.collection) {
      try {
        const handle = await getHandleForActive();
        const profile = await getProfile(handle.profileId);
        schema = await ensureSchema({
          profileId: handle.profileId,
          firestore: handle.firestore,
          collection: input.collection,
          collectionGroup: false,
          sampleSize: profile?.sampleSize ?? 10,
        });
      } catch {
        // No active profile or no Firestore handle yet — fall back to
        // whatever might be in the cache, else null.
        const activeId = await getActiveProfileId();
        if (activeId) {
          schema = await getCachedSchema(activeId, input.collection, false);
        }
      }
    }
    return buildPlan({ provider, settings, cursorSettings, schema }, input);
  });

  register(IpcChannels.executeRun, async ({ plan }) => {
    const handle = await getHandleForActive();
    const profile = await getProfile(handle.profileId);
    const profileScanCap = profile?.scanCap ?? 500;
    return runPlan(
      {
        firestore: handle.firestore,
        profileScanCap,
        getSchema: (collection, collectionGroup) =>
          // ensureSchema returns the cached entry if present and
          // auto-samples otherwise, so the executor's type-coercion
          // safety net always has something to work with.
          ensureSchema({
            profileId: handle.profileId,
            firestore: handle.firestore,
            collection,
            collectionGroup,
            sampleSize: profile?.sampleSize ?? 10,
          }),
      },
      plan,
    );
  });

  register(IpcChannels.collectionsList, async () => {
    const handle = await getHandleForActive();
    const cols = await handle.firestore.listCollections();
    return cols.map((c) => c.id);
  });

  register(IpcChannels.historyList, async ({ limit }) => {
    const activeId = await getActiveProfileId();
    if (!activeId) return { entries: [] };
    const entries = await listHistory(activeId, limit);
    return { entries };
  });

  register(IpcChannels.historyGet, async ({ id }) => {
    const activeId = await getActiveProfileId();
    if (!activeId) return { entry: null };
    const entry = await getHistoryEntry(activeId, id);
    return { entry };
  });

  register(IpcChannels.historyAdd, async ({ question, collection, plan, outcome }) => {
    const activeId = await getActiveProfileId();
    if (!activeId) {
      throw new Error('No active profile — cannot save history.');
    }
    const entry = await addHistoryEntry(activeId, {
      question,
      collection,
      plan,
      outcome,
    });
    return { entry };
  });

  register(IpcChannels.historyClear, async () => {
    const activeId = await getActiveProfileId();
    if (!activeId) return { cleared: 0 };
    const cleared = await clearHistory(activeId);
    return { cleared };
  });

  register(IpcChannels.historyFindCached, async ({ question, collection }) => {
    const activeId = await getActiveProfileId();
    if (!activeId) return { entry: null };
    const entry = await findCachedEntry(activeId, question, collection);
    return { entry };
  });

  register(IpcChannels.insightsGenerate, async (input) => {
    const provider = await getActiveProvider();
    const settings = await getLlmSettings();
    const cursorSettings = await getCursorSettings();
    return generateInsights({ provider, settings, cursorSettings }, input);
  });
}
