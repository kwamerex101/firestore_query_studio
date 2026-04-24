import type {
  CursorSettings,
  ClaudeSettings,
  LlmProvider,
  LlmSettings,
} from '@shared/types/profile';
import type {
  SqlPlanBuildOutcome,
  SqlPlanRequest,
} from '@shared/types/ipc';
import type { SqlTableSampleView } from '@shared/types/sqlPlan';
import {
  buildSqlPlan as sharedBuildSqlPlan,
  openaiChat,
  type ChatBackend,
} from '@shared/planner';
import { chatViaCursor } from './cursorCli';
import { chatViaClaude } from './claudeCli';
import type { SqlDriver } from '../drivers/types';

export interface SqlPlannerDeps {
  provider: LlmProvider;
  settings: LlmSettings | null;
  cursorSettings: CursorSettings | null;
  claudeSettings: ClaudeSettings | null;
  driver: SqlDriver;
  defaultLimit: number;
}

/**
 * Build a SQL query plan for the active relational profile. Mirrors the
 * Firestore `buildPlan` in this directory: we pick the right `ChatBackend`
 * based on the user's provider choice, then hand control to the shared
 * planner which is the only module that understands prompts, JSON
 * extraction, Zod validation, and the final safety re-check.
 */
export async function buildSqlPlan(
  deps: SqlPlannerDeps,
  req: SqlPlanRequest,
): Promise<SqlPlanBuildOutcome> {
  const backend = resolveBackend(deps);
  if (!backend.ok) return backend.outcome;

  // Auto-sample the requested table so the planner always has concrete
  // column names + types. We fail open: if sampling errors (e.g. table
  // doesn't exist), we continue with no schema snapshot and let the
  // planner lean on the question itself. Errors we care about surface
  // later when `db.executeSql` actually runs the statement.
  let schemaSample: SqlTableSampleView[] | null = null;
  if (req.table) {
    try {
      const sample = await deps.driver.sampleTable(
        req.table,
        undefined,
        Math.min(deps.defaultLimit, 10),
      );
      if (sample) {
        schemaSample = [
          {
            table: sample.table,
            schema: sample.schema,
            columns: sample.columns,
            rows: sample.rows as unknown as Array<Record<string, unknown>>,
            sampledCount: sample.sampledCount,
            sampledAt: sample.sampledAt,
          },
        ];
      }
    } catch {
      schemaSample = null;
    }
  }

  return sharedBuildSqlPlan(
    {
      chat: backend.chat,
      chatOptionsOverrides: backend.overrides,
      onFailure: logPlannerFailure,
    },
    {
      question: req.question,
      dialect: deps.driver.dialect,
      schemaSample,
      defaultLimit: deps.defaultLimit,
    },
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
  | { ok: false; outcome: SqlPlanBuildOutcome };

function resolveBackend(deps: SqlPlannerDeps): BackendResolution {
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
        responseFormatJson: false,
      },
    };
  }

  if (deps.provider === 'claude-cli') {
    if (!deps.claudeSettings) {
      return {
        ok: false,
        outcome: {
          ok: false,
          code: 'CLAUDE_NOT_CONFIGURED',
          message:
            'Claude CLI provider is selected but no Claude settings are saved. Open Settings → Claude CLI to configure it.',
        },
      };
    }
    const timeoutMs = deps.claudeSettings.timeoutMs ?? 60_000;
    return {
      ok: true,
      chat: (messages, opts) =>
        chatViaClaude(deps.claudeSettings!, {
          messages,
          timeoutMs: opts.timeoutMs ?? timeoutMs,
        }),
      overrides: {
        timeoutMs,
        retries: 0,
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
  // eslint-disable-next-line no-console
  console.error(
    `\n[sql-planner] ${code} — raw LLM response (${raw.length} chars):\n${raw}\n` +
      (extracted && extracted !== raw
        ? `[sql-planner] extracted JSON text (${extracted.length} chars):\n${extracted}\n`
        : ''),
  );
}
