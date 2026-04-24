import type {
  LlmProvider,
  LlmSettings,
  CursorSettings,
  ClaudeSettings,
} from '@shared/types/profile';
import type {
  InsightsGenerateOutcome,
  InsightsGenerateRequest,
} from '@shared/types/ipc';
import {
  generateInsights as sharedGenerateInsights,
  openaiChat,
  type ChatBackend,
} from '@shared/planner';
import { chatViaCursor } from './cursorCli';
import { chatViaClaude } from './claudeCli';

export interface InsightsDeps {
  provider: LlmProvider;
  settings: LlmSettings | null;
  cursorSettings: CursorSettings | null;
  claudeSettings: ClaudeSettings | null;
}

/**
 * Main-process entry point for generating an insights markdown from a
 * completed run. Prompt assembly, row clipping, and response handling all
 * live in [`@shared/planner`](../../shared/planner/insights.ts); this file
 * only picks the right `ChatBackend`.
 */
export async function generateInsights(
  deps: InsightsDeps,
  req: InsightsGenerateRequest,
): Promise<InsightsGenerateOutcome> {
  const backend = resolveBackend(deps);
  if (!backend.ok) return backend.outcome;

  return sharedGenerateInsights(
    {
      chat: backend.chat,
      chatOptionsOverrides: backend.overrides,
    },
    req,
  );
}

type BackendResolution =
  | {
      ok: true;
      chat: ChatBackend;
      overrides: { timeoutMs: number; retries: number };
    }
  | { ok: false; outcome: InsightsGenerateOutcome };

function resolveBackend(deps: InsightsDeps): BackendResolution {
  if (deps.provider === 'cursor-cli') {
    if (!deps.cursorSettings) {
      return {
        ok: false,
        outcome: {
          ok: false,
          code: 'CURSOR_NOT_CONFIGURED',
          message:
            'Cursor CLI provider is selected but no Cursor settings are saved. Configure it in Settings → Cursor CLI.',
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
      overrides: { timeoutMs, retries: 0 },
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
            'Claude CLI provider is selected but no Claude settings are saved. Configure it in Settings → Claude CLI.',
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
      overrides: { timeoutMs, retries: 0 },
    };
  }

  if (!deps.settings || !deps.settings.apiKey) {
    return {
      ok: false,
      outcome: {
        ok: false,
        code: 'LLM_NOT_CONFIGURED',
        message:
          'Configure an LLM base URL and API key in Settings, or switch to the Cursor CLI provider.',
      },
    };
  }
  const timeoutMs = deps.settings.timeoutMs ?? 30_000;
  // Insight generation is not as critical as planning, so keep retries low.
  const retries = timeoutMs >= 60_000 ? 0 : 1;
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
    overrides: { timeoutMs, retries },
  };
}
