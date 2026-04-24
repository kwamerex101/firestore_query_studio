import type {
  CursorSettings,
  ClaudeSettings,
  LlmProvider,
  LlmSettings,
} from '@shared/types/profile';
import type {
  VisualsGenerateOutcome,
  VisualsGenerateRequest,
} from '@shared/types/ipc';
import {
  generateVisuals as sharedGenerateVisuals,
  openaiChat,
  type ChatBackend,
} from '@shared/planner';
import { chatViaCursor } from './cursorCli';
import { chatViaClaude } from './claudeCli';

export interface VisualsDeps {
  provider: LlmProvider;
  settings: LlmSettings | null;
  cursorSettings: CursorSettings | null;
  claudeSettings: ClaudeSettings | null;
}

/**
 * Main-process entry for AI-generated chart specs. Mirrors
 * [`generateInsights`](./insights.ts): prompt construction + parsing
 * live in `@shared/planner`; this picks the right `ChatBackend`.
 */
export async function generateVisuals(
  deps: VisualsDeps,
  req: VisualsGenerateRequest,
): Promise<VisualsGenerateOutcome> {
  const backend = resolveBackend(deps);
  if (!backend.ok) return backend.outcome;

  return sharedGenerateVisuals(
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
  | { ok: false; outcome: VisualsGenerateOutcome };

function resolveBackend(deps: VisualsDeps): BackendResolution {
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
