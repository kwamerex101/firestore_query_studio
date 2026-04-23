import type { LlmSettings } from '@shared/types/profile';
import {
  ChatBackendError,
  openaiChat,
  type ChatBackendOptions,
  type ChatBackendResponse,
  type LlmMessage,
} from '@shared/planner';

/**
 * Thin main-process wrapper around the shared `openaiChat` client. Exists so
 * legacy imports (`src/main/llm/cursorCli.ts`, older tests) keep working while
 * the real implementation lives in `@shared/planner` and can be shared with
 * the web bundle.
 */

export type { LlmMessage };
export type ChatOptions = ChatBackendOptions;
export type ChatResponse = ChatBackendResponse;

/**
 * Backwards-compat alias for `ChatBackendError`. New code should import the
 * shared error type directly; this alias keeps the `err instanceof LlmError`
 * checks scattered around the main process working unchanged.
 */
export class LlmError extends ChatBackendError {}

// Make `chatResponse throws LlmError` still hold at runtime: surface any
// ChatBackendError thrown from the shared client as an `LlmError` subclass
// so `instanceof LlmError` checks elsewhere keep matching.
function toLlmError(err: unknown): never {
  if (err instanceof LlmError) throw err;
  if (err instanceof ChatBackendError) {
    throw new LlmError(err.message, err.code, err.status, err.rawBody);
  }
  throw err;
}

export async function chat(
  settings: LlmSettings,
  opts: ChatOptions & { messages: LlmMessage[] },
): Promise<ChatResponse> {
  const { messages, ...rest } = opts;
  try {
    return await openaiChat(
      {
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
      },
      messages,
      rest,
    );
  } catch (err) {
    toLlmError(err);
  }
}
