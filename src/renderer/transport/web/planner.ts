import type {
  InsightsGenerateOutcome,
  InsightsGenerateRequest,
  PlanBuildOutcome,
  PlanRequest,
} from '@shared/types/ipc';
import {
  buildPlan as sharedBuildPlan,
  generateInsights as sharedGenerateInsights,
  openaiChat,
  type ChatBackend,
} from '@shared/planner';
import { getLlmSettingsForCall } from './settings';
import { schemaGet } from './schema';
import { getFirebaseConfigFor, getActiveProfileId } from './profiles';

async function buildBackend(): Promise<
  { ok: true; chat: ChatBackend; timeoutMs: number } | { ok: false; code: string; message: string }
> {
  const settings = await getLlmSettingsForCall();
  if (!settings || !settings.apiKey) {
    return {
      ok: false,
      code: 'LLM_NOT_CONFIGURED',
      message:
        'Configure your LLM base URL, model, and API key in Settings before building a plan.',
    };
  }
  const timeoutMs = settings.timeoutMs ?? 30_000;
  return {
    ok: true,
    timeoutMs,
    chat: (messages, opts) =>
      openaiChat(
        {
          baseUrl: settings.baseUrl,
          model: settings.model,
          apiKey: settings.apiKey,
        },
        messages,
        opts,
      ),
  };
}

export async function planBuild(req: PlanRequest): Promise<PlanBuildOutcome> {
  const backend = await buildBackend();
  if (!backend.ok) {
    return { ok: false, code: backend.code, message: backend.message };
  }

  // Try to surface any saved schema override to the planner. On web we
  // don't run a schema sample here — it costs Firestore reads and can
  // surprise the user. The UI has an explicit "Sample schema" button that
  // saves/overrides into IndexedDB; we just pick it up if present.
  const activeId = await getActiveProfileId();
  const hasConfig = activeId ? await getFirebaseConfigFor(activeId) : null;
  const override = req.collection
    ? await schemaGet({ collection: req.collection, collectionGroup: false })
    : null;

  // Light warning baked into the plan rationale: without Firebase config
  // saved, the plan is still useful (the user can inspect it) but the
  // subsequent `execute.run` will fail with PROFILE_NOT_CONFIGURED.
  void hasConfig;

  return sharedBuildPlan(
    {
      chat: backend.chat,
      chatOptionsOverrides: {
        timeoutMs: backend.timeoutMs,
        retries: backend.timeoutMs >= 60_000 ? 0 : 2,
        responseFormatJson: true,
      },
      schema: override,
      onFailure: (code, raw, extracted) => {
        // Browser console is the right home for web-side planner diagnostics.
        // eslint-disable-next-line no-console
        console.error(
          `[planner] ${code} — raw LLM response (${raw.length} chars)`,
          raw,
          extracted && extracted !== raw
            ? { extracted: `${extracted.length} chars` }
            : undefined,
        );
      },
    },
    req,
  );
}

export async function insightsGenerate(
  req: InsightsGenerateRequest,
): Promise<InsightsGenerateOutcome> {
  const backend = await buildBackend();
  if (!backend.ok) {
    return { ok: false, code: backend.code, message: backend.message };
  }
  return sharedGenerateInsights(
    {
      chat: backend.chat,
      chatOptionsOverrides: {
        timeoutMs: backend.timeoutMs,
        retries: backend.timeoutMs >= 60_000 ? 0 : 1,
        temperature: 0.2,
      },
    },
    req,
  );
}
