import { ipcMain, type WebContents } from 'electron';
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
  getClaudeSettings,
  setClaudeSettings,
  getSheetsSettings,
  setSheetsSettings,
  getSheetsTokens,
  setSheetsTokens,
  clearSheetsTokens,
  getActiveProvider,
  setActiveProvider,
} from '../profiles/secrets';
import {
  getDriverForActive,
  getHandleForActive,
  getSqlDriverForActive,
  onProfileChanged,
  testConnectionForProfile,
} from '../firestore/connectionManager';
import { sampleCollection } from '../firestore/schemaSampler';
import {
  ensureSchema,
  getCachedSchema,
  setCachedSchema,
} from '../firestore/schemaCache';
import { runPlan } from '../firestore/executor';
import { runPlanStream } from '../firestore/streamExecutor';
import {
  cancelRun,
  createRun,
  sendBatch,
  sendDone,
  sendError,
  sendExportDone,
  sendExportError,
  sendExportProgress,
} from './streamRuns';
import { startExport } from '../export/streamExport';
import { buildPlan } from '../llm/planner';
import { buildSqlPlan } from '../llm/sqlPlanner';
import { getProfile } from '../profiles/profileStore';
import { getProfileSecret } from '../profiles/secrets';
import {
  isFirestoreProfile,
  isMssqlProfile,
  isRtdbProfile,
  isSqlProfile,
} from '@shared/types/profile';
import type { SqlDialect } from '@shared/types/profile';
import type { SqlProbeDraft } from '@shared/types/ipc';
import { RtdbDriver, probeSqlDatabases, probeSqlSchemas } from '../drivers';
import type { SqlProbeConfig } from '../drivers/types';
import { chat, LlmError } from '../llm/openaiCompat';
import { listCursorModels, testCursorCli } from '../llm/cursorCli';
import { listClaudeModels, testClaudeCli } from '../llm/claudeCli';
import { runSheetsOAuth, hasValidTokens } from '../export/sheetsAuth';
import {
  appendToSpreadsheet,
  createSpreadsheet,
} from '../export/sheetsApi';
import {
  addHistoryEntry,
  clearHistory,
  findCachedEntry,
  getHistoryEntry,
  listHistory,
} from '../history/historyStore';
import { generateInsights } from '../llm/insights';
import { generateVisuals } from '../llm/visuals';
import {
  importServiceAccount,
  pickServiceAccount,
  validateServiceAccount,
} from '../dialogs/serviceAccount';
import { pickDataFile } from '../dialogs/dataFile';

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

type HandlerWithSender<C extends IpcChannel> = (
  req: z.infer<(typeof ipcApi)[C]['request']>,
  sender: WebContents,
) => Promise<z.infer<(typeof ipcApi)[C]['response']>>;

function registerWithSender<C extends IpcChannel>(
  channel: C,
  handler: HandlerWithSender<C>,
): void {
  ipcMain.handle(channel, async (event, payload: unknown) => {
    const requestSchema = ipcApi[channel].request;
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        `Invalid IPC request for ${channel}: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
      );
    }
    return handler(parsed.data as never, event.sender);
  });
}

/**
 * Merge a saved profile's connection fields with an optional in-flight
 * form draft, resolving the password from the keychain when the draft
 * doesn't supply one. Used by the two SQL probe handlers so discovery
 * works for both "new profile" (draft only) and "edit profile without
 * retyping password" (profileId only) flows.
 */
async function resolveProbeCfg(args: {
  profileId?: string;
  draft?: SqlProbeDraft;
}): Promise<SqlProbeConfig> {
  const { profileId, draft } = args;
  if (!profileId && !draft) {
    throw new Error('PROBE_MISSING_INPUTS: provide either profileId or draft.');
  }

  // Start from the draft (if any) so new-profile flows work with no
  // persisted profile at all.
  let engine: SqlDialect | undefined = draft?.engine;
  let host = draft?.host;
  let port = draft?.port;
  let user = draft?.user;
  let sslMode = draft?.sslMode;
  let encrypt = draft?.encrypt;
  let trustServerCertificate = draft?.trustServerCertificate;
  let instanceName = draft?.instanceName;
  let password: string | null = draft?.password && draft.password.length > 0 ? draft.password : null;

  if (profileId) {
    const saved = await getProfile(profileId);
    // BigQuery authenticates via service-account JSON / ADC, not host/port/user,
    // so the shared "probe config" flow doesn't apply. Callers that need to
    // list BigQuery datasets should go through a dedicated path.
    if (
      saved &&
      isSqlProfile(saved) &&
      saved.engine !== 'bigquery' &&
      saved.engine !== 'file'
    ) {
      engine = engine ?? (saved.engine as SqlDialect);
      host = host ?? saved.host;
      port = port ?? saved.port;
      user = user ?? saved.user;
      if (isMssqlProfile(saved)) {
        // MSSQL stores encrypt/trust/instance instead of sslMode.
        encrypt = encrypt ?? saved.encrypt;
        trustServerCertificate = trustServerCertificate ?? saved.trustServerCertificate;
        instanceName = instanceName ?? (saved.instanceName || undefined);
      } else {
        sslMode = sslMode ?? saved.sslMode;
      }
      if (!password) {
        password = await getProfileSecret(profileId);
      }
    }
  }

  if (!engine || !host || !port || !user) {
    throw new Error('PROBE_MISSING_INPUTS: engine/host/port/user are required.');
  }

  return {
    engine,
    host,
    port,
    user,
    password,
    sslMode: sslMode ?? 'disable',
    encrypt,
    trustServerCertificate,
    instanceName,
  };
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

  register(IpcChannels.claudeGet, async () => {
    const s = await getClaudeSettings();
    if (!s) return { isConfigured: false };
    return {
      isConfigured: true,
      command: s.command,
      model: s.model,
      permissionMode: s.permissionMode,
      extraArgs: s.extraArgs,
      cwd: s.cwd,
      envVars: s.envVars,
      timeoutMs: s.timeoutMs,
    };
  });

  register(IpcChannels.claudeSet, async (input) => {
    const saved = await setClaudeSettings(input);
    return {
      isConfigured: true,
      command: saved.command,
      model: saved.model,
      permissionMode: saved.permissionMode,
      extraArgs: saved.extraArgs,
      cwd: saved.cwd,
      envVars: saved.envVars,
      timeoutMs: saved.timeoutMs,
    };
  });

  register(IpcChannels.claudeListModels, async () => {
    const s = await getClaudeSettings();
    if (!s) {
      // Surface the fallback list even when the CLI isn't configured yet so
      // the Settings dropdown has something to show pre-save.
      return listClaudeModels({
        command: 'claude',
        model: 'sonnet',
        permissionMode: 'default',
        extraArgs: [],
        envVars: {},
        timeoutMs: 60_000,
      });
    }
    return listClaudeModels(s);
  });

  register(IpcChannels.claudeTest, async (input) => {
    const effective = input ?? (await getClaudeSettings());
    if (!effective) {
      return {
        ok: false as const,
        code: 'NOT_CONFIGURED',
        message: 'Configure the Claude CLI before running a test.',
      };
    }
    return testClaudeCli(effective);
  });

  register(IpcChannels.sheetsGet, async () => {
    const settings = await getSheetsSettings();
    const tokens = await getSheetsTokens();
    return {
      hasClient: !!settings,
      clientId: settings?.clientId,
      hasSecret: !!settings?.clientSecret,
      connected: hasValidTokens(tokens),
      scope: tokens?.scope ?? null,
    };
  });

  register(IpcChannels.sheetsSet, async (input) => {
    const saved = await setSheetsSettings(input);
    const tokens = await getSheetsTokens();
    return {
      hasClient: true,
      clientId: saved.clientId,
      hasSecret: !!saved.clientSecret,
      connected: hasValidTokens(tokens),
      scope: tokens?.scope ?? null,
    };
  });

  register(IpcChannels.sheetsSignIn, async () => {
    const settings = await getSheetsSettings();
    if (!settings) {
      return {
        ok: false as const,
        code: 'NOT_CONFIGURED',
        message:
          'Save a Google OAuth client ID and secret before signing in.',
      };
    }
    try {
      const tokens = await runSheetsOAuth(settings);
      if (!tokens.refreshToken) {
        return {
          ok: false as const,
          code: 'NO_REFRESH_TOKEN',
          message:
            'Google did not return a refresh token. Revoke the previous grant at myaccount.google.com/permissions and try again.',
        };
      }
      await setSheetsTokens(tokens);
      return { ok: true as const, scope: tokens.scope };
    } catch (err) {
      return {
        ok: false as const,
        code: 'OAUTH_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });

  register(IpcChannels.sheetsSignOut, async () => {
    await clearSheetsTokens();
    const settings = await getSheetsSettings();
    return {
      hasClient: !!settings,
      clientId: settings?.clientId,
      hasSecret: !!settings?.clientSecret,
      connected: false,
      scope: null,
    };
  });

  register(IpcChannels.sheetsExportCreate, async (input) => {
    const settings = await getSheetsSettings();
    const tokens = await getSheetsTokens();
    if (!settings || !hasValidTokens(tokens)) {
      return {
        ok: false as const,
        code: 'NOT_CONNECTED',
        message:
          'Sign in to Google Sheets from Settings → Google Sheets before exporting.',
      };
    }
    try {
      const result = await createSpreadsheet({
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        tokens: tokens!,
        title: input.title,
        columns: input.columns,
        rows: input.rows,
      });
      return { ok: true as const, ...result };
    } catch (err) {
      return {
        ok: false as const,
        code: 'EXPORT_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });

  register(IpcChannels.sheetsExportAppend, async (input) => {
    const settings = await getSheetsSettings();
    const tokens = await getSheetsTokens();
    if (!settings || !hasValidTokens(tokens)) {
      return {
        ok: false as const,
        code: 'NOT_CONNECTED',
        message:
          'Sign in to Google Sheets from Settings → Google Sheets before exporting.',
      };
    }
    try {
      const result = await appendToSpreadsheet({
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        tokens: tokens!,
        columns: input.columns,
        rows: input.rows,
        spreadsheetRef: input.spreadsheetRef,
        sheetName: input.sheetName,
      });
      return { ok: true as const, ...result };
    } catch (err) {
      return {
        ok: false as const,
        code: 'EXPORT_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };
    }
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
    const activeId = await getActiveProfileId();
    if (activeId) {
      const p = await getProfile(activeId);
      if (p && isRtdbProfile(p)) {
        throw new Error(
          'Collection schema sampling is for Firestore. Switch to a Firestore profile or use the Realtime path reader.',
        );
      }
    }
    const handle = await getHandleForActive();
    const activeProfile = await getProfile(handle.profileId);
    // `getHandleForActive` has already narrowed to Firestore. The `isFirestoreProfile`
    // guard just re-establishes the narrowing for TypeScript.
    const effectiveSize =
      sampleSize ??
      (activeProfile && isFirestoreProfile(activeProfile) ? activeProfile.sampleSize : 10);
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
    const claudeSettings = await getClaudeSettings();

    const activeId = await getActiveProfileId();
    if (activeId) {
      const p = await getProfile(activeId);
      if (p && isRtdbProfile(p)) {
        return {
          ok: false,
          code: 'WRONG_ENGINE',
          message:
            'NL→Firestore plans require a Firestore profile. Switch the active profile or use the Realtime path reader for RTDB.',
        };
      }
    }

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
          'Configure the Cursor CLI in Settings → Cursor CLI, or switch back to an OpenAI-compatible endpoint in Settings → LLM.',
      };
    }
    if (provider === 'claude-cli' && !claudeSettings) {
      return {
        ok: false,
        code: 'CLAUDE_NOT_CONFIGURED',
        message:
          'Configure the Claude CLI in Settings → Claude CLI, or switch back to an OpenAI-compatible endpoint in Settings → LLM.',
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
        const sampleSize =
          profile && isFirestoreProfile(profile) ? profile.sampleSize : 10;
        schema = await ensureSchema({
          profileId: handle.profileId,
          firestore: handle.firestore,
          collection: input.collection,
          collectionGroup: false,
          sampleSize,
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
    return buildPlan(
      { provider, settings, cursorSettings, claudeSettings, schema },
      input,
    );
  });

  register(IpcChannels.executeRun, async ({ plan }) => {
    const activeId = await getActiveProfileId();
    if (activeId) {
      const p = await getProfile(activeId);
      if (p && isRtdbProfile(p)) {
        return {
          ok: false,
          code: 'WRONG_ENGINE',
          message: 'This runner is for Firestore query plans. Use the Realtime path reader for RTDB.',
          warnings: [],
        };
      }
    }
    const handle = await getHandleForActive();
    const profile = await getProfile(handle.profileId);
    const firestoreProfile =
      profile && isFirestoreProfile(profile) ? profile : null;
    const profileScanCap = firestoreProfile?.scanCap ?? 500;
    const profileSampleSize = firestoreProfile?.sampleSize ?? 10;
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
            sampleSize: profileSampleSize,
          }),
      },
      plan,
    );
  });

  register(IpcChannels.collectionsList, async () => {
    const activeId = await getActiveProfileId();
    if (!activeId) return [];
    const p = await getProfile(activeId);
    if (p && isRtdbProfile(p)) {
      const driver = await getDriverForActive();
      if (!(driver instanceof RtdbDriver)) {
        throw new Error('Expected an RTDB driver for the active profile.');
      }
      const rows = await driver.listContainers();
      return rows.map((c) => c.name);
    }
    const handle = await getHandleForActive();
    const cols = await handle.firestore.listCollections();
    return cols.map((c) => c.id);
  });

  register(IpcChannels.rtdbRead, async ({ path: pathArg }) => {
    const driver = await getDriverForActive();
    if (!(driver instanceof RtdbDriver)) {
      return {
        ok: false,
        code: 'WRONG_ENGINE',
        message: 'Select a Realtime Database profile to read paths.',
      };
    }
    try {
      const { value } = await driver.readPath(pathArg);
      return { ok: true, value } as const;
    } catch (e) {
      return {
        ok: false,
        code: 'RTDB_READ_FAILED',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });

  register(IpcChannels.dbTestConnection, async ({ profileId }) => {
    const targetId = profileId ?? (await getActiveProfileId());
    if (!targetId) {
      return {
        ok: false as const,
        code: 'NO_PROFILE',
        message: 'No active profile to test.',
        elapsedMs: 0,
      };
    }
    return testConnectionForProfile(targetId);
  });

  register(IpcChannels.dbProbeSqlDatabases, async ({ profileId, draft }) => {
    try {
      const cfg = await resolveProbeCfg({ profileId, draft });
      return probeSqlDatabases(cfg.engine, cfg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const codeMatch = /^([A-Z_]+):/.exec(message);
      return {
        ok: false as const,
        code: codeMatch?.[1] ?? 'PROBE_FAILED',
        message,
        elapsedMs: 0,
      };
    }
  });

  register(IpcChannels.dbProbeSqlSchemas, async ({ profileId, draft, database }) => {
    try {
      const cfg = await resolveProbeCfg({ profileId, draft });
      return probeSqlSchemas(cfg.engine, cfg, database);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const codeMatch = /^([A-Z_]+):/.exec(message);
      return {
        ok: false as const,
        code: codeMatch?.[1] ?? 'PROBE_FAILED',
        message,
        elapsedMs: 0,
      };
    }
  });

  register(IpcChannels.dbListContainers, async () => {
    const driver = await getDriverForActive();
    const containers = await driver.listContainers();
    return { containers };
  });

  register(IpcChannels.dbExecuteSql, async ({ sql, limit }) => {
    const driver = await getSqlDriverForActive();
    const result = await driver.runReadOnlyQuery(sql, { limit });
    return result;
  });

  register(IpcChannels.dbSampleTable, async ({ table, schema, sampleSize }) => {
    const driver = await getSqlDriverForActive();
    const sample = await driver.sampleTable(table, schema, sampleSize);
    return { sample };
  });

  register(IpcChannels.planBuildSql, async (input) => {
    const activeId = await getActiveProfileId();
    if (!activeId) {
      return {
        ok: false,
        code: 'NO_PROFILE',
        message: 'No active profile.',
      };
    }
    const profile = await getProfile(activeId);
    if (!profile) {
      return {
        ok: false,
        code: 'NO_PROFILE',
        message: `Active profile not found: ${activeId}`,
      };
    }
    if (!isSqlProfile(profile)) {
      return {
        ok: false,
        code: 'WRONG_ENGINE',
        message: `plan.buildSql requires a SQL engine; active profile uses ${profile.engine}.`,
      };
    }
    const provider = await getActiveProvider();
    const settings = await getLlmSettings();
    const cursorSettings = await getCursorSettings();
    const claudeSettings = await getClaudeSettings();
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
          'Configure the Cursor CLI in Settings → Cursor CLI, or switch back to an OpenAI-compatible endpoint in Settings → LLM.',
      };
    }
    if (provider === 'claude-cli' && !claudeSettings) {
      return {
        ok: false,
        code: 'CLAUDE_NOT_CONFIGURED',
        message:
          'Configure the Claude CLI in Settings → Claude CLI, or switch back to an OpenAI-compatible endpoint in Settings → LLM.',
      };
    }
    const driver = await getSqlDriverForActive();
    return buildSqlPlan(
      {
        provider,
        settings,
        cursorSettings,
        claudeSettings,
        driver,
        defaultLimit: profile.defaultLimit,
      },
      input,
    );
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

  register(IpcChannels.historyAdd, async (req) => {
    const activeId = await getActiveProfileId();
    if (!activeId) {
      throw new Error('No active profile — cannot save history.');
    }
    if (req.source === 'sql') {
      const entry = await addHistoryEntry(activeId, {
        kind: 'sql',
        question: req.question,
        sqlPlan: req.sqlPlan,
        outcome: req.outcome,
      });
      return { entry };
    }
    const entry = await addHistoryEntry(activeId, {
      kind: 'firestore',
      question: req.question,
      collection: req.collection,
      plan: req.plan,
      outcome: req.outcome,
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
    const claudeSettings = await getClaudeSettings();
    return generateInsights(
      { provider, settings, cursorSettings, claudeSettings },
      input,
    );
  });

  register(IpcChannels.visualsGenerate, async (input) => {
    const provider = await getActiveProvider();
    const settings = await getLlmSettings();
    const cursorSettings = await getCursorSettings();
    const claudeSettings = await getClaudeSettings();
    return generateVisuals(
      { provider, settings, cursorSettings, claudeSettings },
      input,
    );
  });

  register(IpcChannels.dialogPickServiceAccount, async () => {
    return pickServiceAccount();
  });

  register(IpcChannels.dialogValidateServiceAccount, async (input) => {
    return validateServiceAccount(input);
  });

  register(IpcChannels.dialogImportServiceAccount, async (input) => {
    return importServiceAccount(input);
  });

  register(IpcChannels.dialogPickDataFile, async () => {
    return pickDataFile();
  });

  registerWithSender(IpcChannels.sqlStreamStart, async (input, sender) => {
    const driver = await getSqlDriverForActive();
    const uiLimit = Math.max(1, Math.min(input.uiLimit ?? 50_000, 200_000));
    const hardLimit = Math.max(
      uiLimit,
      Math.min(input.hardLimit ?? uiLimit, driver.profile.defaultLimit),
    );
    const batchSize = Math.max(100, Math.min(input.batchSize ?? 5_000, 50_000));
    const memoryMb =
      (driver.profile as { maxMemoryMb?: number }).maxMemoryMb ?? 512;
    const run = createRun(sender, memoryMb);
    const runId = run.runId;
    let deliveredRows = 0;
    let firstBatch = true;
    void (async () => {
      try {
        const outcome = await driver.streamReadOnlyQuery(input.sql, {
          hardLimit,
          batchSize,
          signal: run.abortController.signal,
          onBatch: (rows, meta) => {
            if (run.abortController.signal.aborted) return;
            // Clamp the delivered rows to `uiLimit` — the driver may
            // still keep streaming for a stream-to-disk export that
            // shares the same `streamReadOnlyQuery` call, but the
            // renderer never needs more than `uiLimit`.
            if (deliveredRows >= uiLimit) return;
            const remaining = uiLimit - deliveredRows;
            const sliced = rows.length > remaining ? rows.slice(0, remaining) : rows;
            sendBatch(run, {
              runId,
              rowIndexStart: meta.rowIndexStart,
              rows: sliced,
              columns: firstBatch ? meta.columns : undefined,
            });
            firstBatch = false;
            deliveredRows += sliced.length;
          },
        });
        if (!outcome.ok) {
          sendError(run, {
            runId,
            code: outcome.code,
            message: outcome.message,
            elapsedMs: outcome.elapsedMs,
            executedSql: outcome.executedSql,
          });
          return;
        }
        sendDone(run, {
          runId,
          totalRows: outcome.totalRows,
          deliveredRows,
          elapsedMs: outcome.elapsedMs,
          truncated: outcome.truncated,
          uiTruncated: deliveredRows >= uiLimit && outcome.totalRows > uiLimit,
          warnings: [],
        });
      } catch (err) {
        sendError(run, {
          runId,
          code: 'SQL_STREAM_FAILED',
          message: err instanceof Error ? err.message : String(err),
          elapsedMs: 0,
        });
      }
    })();
    return { ok: true as const, runId, uiLimit, hardLimit };
  });

  registerWithSender(IpcChannels.executeStreamStart, async (input, sender) => {
    const apId = await getActiveProfileId();
    if (apId) {
      const p = await getProfile(apId);
      if (p && isRtdbProfile(p)) {
        throw new Error(
          'Streaming Firestore execution is not available for Realtime Database profiles. Use the path reader or switch to Firestore.',
        );
      }
    }
    const handle = await getHandleForActive();
    const profile = await getProfile(handle.profileId);
    const firestoreProfile =
      profile && isFirestoreProfile(profile) ? profile : null;
    const profileScanCap = firestoreProfile?.scanCap ?? 500;
    const profileSampleSize = firestoreProfile?.sampleSize ?? 10;
    const memoryMb = firestoreProfile?.maxMemoryMb ?? 512;
    const uiLimit = Math.max(1, Math.min(input.uiLimit ?? 50_000, 200_000));
    const hardLimit = Math.max(uiLimit, Math.min(input.hardLimit ?? uiLimit, 10_000_000));
    const batchSize = Math.max(100, Math.min(input.batchSize ?? 5_000, 50_000));
    const run = createRun(sender, memoryMb);
    const runId = run.runId;
    let deliveredRows = 0;
    let firstBatch = true;
    void (async () => {
      const outcome = await runPlanStream(
        {
          firestore: handle.firestore,
          profileScanCap,
          getSchema: (collection, collectionGroup) =>
            ensureSchema({
              profileId: handle.profileId,
              firestore: handle.firestore,
              collection,
              collectionGroup,
              sampleSize: profileSampleSize,
            }),
        },
        input.plan,
        {
          hardLimit,
          batchSize,
          signal: run.abortController.signal,
          onBatch: (rows, meta) => {
            if (run.abortController.signal.aborted) return;
            if (deliveredRows >= uiLimit) return;
            const remaining = uiLimit - deliveredRows;
            const sliced = rows.length > remaining ? rows.slice(0, remaining) : rows;
            // Firestore rows are `ResultRow` objects; encode them as
            // tuples so the renderer's row-window store stays in a
            // single columnar layout for both SQL and Firestore.
            const tupleRows = sliced.map((r) => [r.id, r.path, r.data]);
            sendBatch(run, {
              runId,
              rowIndexStart: meta.rowIndexStart,
              rows: tupleRows,
              columns: firstBatch
                ? [
                    { name: '__id', dataType: 'string' },
                    { name: '__path', dataType: 'string' },
                    { name: 'data', dataType: 'json' },
                  ]
                : undefined,
            });
            firstBatch = false;
            deliveredRows += sliced.length;
          },
        },
      );
      if (!outcome.ok) {
        sendError(run, {
          runId,
          code: outcome.code,
          message: outcome.message,
          elapsedMs: outcome.elapsedMs,
        });
        return;
      }
      sendDone(run, {
        runId,
        totalRows: outcome.totalRows,
        deliveredRows,
        elapsedMs: outcome.elapsedMs,
        truncated: outcome.truncated,
        uiTruncated: deliveredRows >= uiLimit && outcome.totalRows > uiLimit,
        warnings: outcome.warnings,
      });
    })();
    return { ok: true as const, runId, uiLimit, hardLimit };
  });

  register(IpcChannels.streamCancel, async ({ runId }) => {
    cancelRun(runId);
    return { ok: true as const };
  });

  registerWithSender(IpcChannels.exportStart, async (input, sender) => {
    return startExport(input, sender, {
      sendProgress: sendExportProgress,
      sendDone: sendExportDone,
      sendError: sendExportError,
    });
  });

  register(IpcChannels.exportCancel, async ({ runId }) => {
    cancelRun(runId);
    return { ok: true as const };
  });
}
