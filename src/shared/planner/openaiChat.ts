import {
  ChatBackendError,
  type ChatBackendOptions,
  type ChatBackendResponse,
  type LlmMessage,
} from './types';

/**
 * OpenAI-compatible chat client. Uses `fetch` + `AbortController` + `setTimeout`
 * — all available in modern browsers, Node ≥18 and Electron, so this module
 * stays in `@shared` and is consumed by both shells without adapters.
 *
 * Why a standalone implementation and not the OpenAI SDK? We talk to
 * OpenAI, Anthropic-via-proxy, Ollama, LM Studio, vLLM, LiteLLM, etc. — any
 * endpoint exposing `/chat/completions`. Keeping this lean avoids pulling
 * their SDKs (and their dependency on `stream` / `http`) into the web bundle.
 */

export interface OpenAiChatSettings {
  /** Base URL of an OpenAI-compatible server, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  model: string;
  /** Optional bearer token. Omit for local servers that don't require auth. */
  apiKey?: string | null;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function openaiChat(
  settings: OpenAiChatSettings,
  messages: LlmMessage[],
  opts: ChatBackendOptions = {},
): Promise<ChatBackendResponse> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const url = joinUrl(settings.baseUrl, '/chat/completions');

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: opts.temperature ?? 0,
  };
  if (opts.maxOutputTokens) body.max_tokens = opts.maxOutputTokens;
  if (opts.responseFormatJson) body.response_format = { type: 'json_object' };

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await doChat(url, settings, body, timeoutMs);
    } catch (err) {
      lastError = err;
      const retriable =
        err instanceof ChatBackendError &&
        (err.code === 'TIMEOUT' ||
          err.code === 'NETWORK_ERROR' ||
          (err.code === 'HTTP_ERROR' &&
            err.status !== undefined &&
            err.status >= 500));
      if (!retriable || attempt === retries) throw err;
      const backoff = Math.min(1000 * 2 ** attempt, 8000);
      await sleep(backoff);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function doChat(
  url: string,
  settings: OpenAiChatSettings,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<ChatBackendResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const rawBody = await resp.text();
    if (!resp.ok) {
      throw new ChatBackendError(
        `LLM endpoint returned ${resp.status}: ${truncate(rawBody, 500)}`,
        'HTTP_ERROR',
        resp.status,
        rawBody,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new ChatBackendError(
        'LLM response was not valid JSON',
        'PARSE_ERROR',
        resp.status,
        rawBody,
      );
    }
    const content = extractContent(parsed);
    if (content === null) {
      throw new ChatBackendError(
        'LLM response missing choices[0].message.content',
        'PARSE_ERROR',
        resp.status,
        rawBody,
      );
    }
    return {
      content,
      rawBody,
      model: settings.model,
    };
  } catch (err) {
    if (err instanceof ChatBackendError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ChatBackendError(
        `LLM request timed out after ${timeoutMs}ms`,
        'TIMEOUT',
      );
    }
    throw new ChatBackendError(
      `LLM request failed: ${err instanceof Error ? err.message : String(err)}`,
      'NETWORK_ERROR',
    );
  } finally {
    clearTimeout(timer);
  }
}

function extractContent(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content !== 'string') return null;
  return content;
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}
