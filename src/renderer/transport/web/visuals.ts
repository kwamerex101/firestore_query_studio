import type {
  VisualsGenerateOutcome,
  VisualsGenerateRequest,
} from '@shared/types/ipc';
import {
  generateVisuals as sharedGenerateVisuals,
  openaiChat,
  type ChatBackend,
} from '@shared/planner';
import { getLlmSettingsForCall } from './settings';

async function buildBackend(): Promise<
  | { ok: true; chat: ChatBackend; timeoutMs: number }
  | { ok: false; code: string; message: string }
> {
  const settings = await getLlmSettingsForCall();
  if (!settings || !settings.apiKey) {
    return {
      ok: false,
      code: 'LLM_NOT_CONFIGURED',
      message:
        'Configure your LLM base URL, model, and API key in Settings before generating charts.',
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

export async function visualsGenerate(
  req: VisualsGenerateRequest,
): Promise<VisualsGenerateOutcome> {
  const backend = await buildBackend();
  if (!backend.ok) {
    return { ok: false, code: backend.code, message: backend.message };
  }
  return sharedGenerateVisuals(
    {
      chat: backend.chat,
      chatOptionsOverrides: {
        timeoutMs: backend.timeoutMs,
        retries: backend.timeoutMs >= 60_000 ? 0 : 1,
        temperature: 0.2,
        responseFormatJson: true,
      },
    },
    req,
  );
}
