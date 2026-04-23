import type {
  LlmSettings,
  LlmProvider,
  CursorSettings,
} from '@shared/types/profile';
import type { CollectionSchema } from '@shared/types/schema';
import type { PlanBuildOutcome, PlanRequest } from '@shared/types/ipc';
import {
  buildPlan as sharedBuildPlan,
  openaiChat,
  type ChatBackend,
} from '@shared/planner';
import { chatViaCursor } from './cursorCli';

export interface PlannerDeps {
  provider: LlmProvider;
  settings: LlmSettings | null;
  cursorSettings: CursorSettings | null;
  schema?: CollectionSchema | null;
}

/**
 * Main-process entry point for building a Firestore query plan. All the pure
 * planning logic (prompt assembly, JSON extraction, Zod validation) lives in
 * [`@shared/planner`](../../shared/planner/planner.ts); this file only deals
 * with picking the right `ChatBackend` (openai-compat vs Cursor CLI) and
 * returning the `*_NOT_CONFIGURED` outcomes when settings are missing.
 */
export async function buildPlan(
  deps: PlannerDeps,
  req: PlanRequest,
): Promise<PlanBuildOutcome> {
  const backend = resolveBackend(deps);
  if (!backend.ok) return backend.outcome;

  return sharedBuildPlan(
    {
      chat: backend.chat,
      chatOptionsOverrides: backend.overrides,
      schema: deps.schema,
      onFailure: logPlannerFailure,
    },
    req,
  );
}

type BackendResolution =
  | {
      ok: true;
      chat: ChatBackend;
      overrides: {
        timeoutMs: number;
        retries: number;
        responseFormatJson: boolean;
      };
    }
  | { ok: false; outcome: PlanBuildOutcome };

function resolveBackend(deps: PlannerDeps): BackendResolution {
  if (deps.provider === 'cursor-cli') {
    if (!deps.cursorSettings) {
      return {
        ok: false,
        outcome: {
          ok: false,
          code: 'CURSOR_NOT_CONFIGURED',
          message:
            'Cursor CLI provider is selected but no Cursor settings are saved. Open Settings → Cursor CLI to configure it.',
        },
      };
    }
    const timeoutMs = deps.cursorSettings.timeoutMs ?? 60_000;
    return {
      ok: true,
      chat: (messages, opts) =>
        chatViaCursor(deps.cursorSettings!, {
          messages,
          timeoutMs: opts.timeoutMs ?? timeoutMs,
        }),
      overrides: {
        timeoutMs,
        retries: 0,
        // Cursor CLI can't honour `response_format: json_object`; the planner
        // still falls back to `extractJsonObject` on the raw text.
        responseFormatJson: false,
      },
    };
  }

  if (!deps.settings) {
    return {
      ok: false,
      outcome: {
        ok: false,
        code: 'LLM_NOT_CONFIGURED',
        message:
          'Configure an LLM base URL and API key in settings before running queries.',
      },
    };
  }
  const timeoutMs = deps.settings.timeoutMs ?? 30_000;
  // Long timeouts usually mean local models — retrying wastes minutes on
  // each failure and rarely helps, so back retries off as timeouts grow.
  const retries = timeoutMs >= 60_000 ? 0 : 2;
  const settings = deps.settings;
  return {
    ok: true,
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
    overrides: {
      timeoutMs,
      retries,
      responseFormatJson: true,
    },
  };
}

function logPlannerFailure(
  code: string,
  raw: string,
  extracted?: string,
): void {
  // Main-process logging: appears in the terminal where `pnpm dev` is running.
  // eslint-disable-next-line no-console
  console.error(
    `\n[planner] ${code} — raw LLM response (${raw.length} chars):\n${raw}\n` +
      (extracted && extracted !== raw
        ? `[planner] extracted JSON text (${extracted.length} chars):\n${extracted}\n`
        : ''),
  );
}
