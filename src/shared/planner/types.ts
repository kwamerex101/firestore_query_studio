/**
 * Lightweight types for the shared planner/insights modules. Everything here
 * is transport-agnostic: no Node, no Electron, no Firebase — just data + the
 * `ChatBackend` contract that each shell plugs into.
 *
 * Kept deliberately separate from `@shared/types/profile` so the web bundle
 * doesn't have to drag in profile/IPC types it doesn't need.
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatBackendOptions {
  temperature?: number;
  timeoutMs?: number;
  retries?: number;
  maxOutputTokens?: number;
  /**
   * Hint to the backend that the response MUST be a JSON object. OpenAI-compat
   * backends translate this to `response_format: { type: 'json_object' }`.
   * Backends that don't support forced JSON (e.g. the Cursor CLI) may ignore
   * it — the planner always falls back to `extractJsonObject` anyway.
   */
  responseFormatJson?: boolean;
}

export interface ChatBackendResponse {
  /** The raw assistant text. The planner parses this; insights returns it trimmed. */
  content: string;
  /** Reported model id, used for telemetry and the insights panel footer. */
  model: string;
  /** Optional raw HTTP body for debugging; backends may omit it. */
  rawBody?: string;
}

/**
 * A transport-agnostic "ask an LLM" function. Every shell (Electron main,
 * web BYOK fetch, Cursor CLI subprocess) exposes its chat path through one
 * of these, so the shared planner never has to know what's underneath.
 */
export type ChatBackend = (
  messages: LlmMessage[],
  options: ChatBackendOptions,
) => Promise<ChatBackendResponse>;

/**
 * Error class the shared planner expects backends to throw when something
 * goes wrong at the LLM transport layer. Shells MAY subclass this or throw
 * matching structural objects — `buildPlan`/`generateInsights` only look at
 * `code` and `message`.
 */
export type ChatBackendErrorCode =
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'PARSE_ERROR';

export class ChatBackendError extends Error {
  readonly code: ChatBackendErrorCode;
  readonly status?: number;
  readonly rawBody?: string;

  constructor(
    message: string,
    code: ChatBackendErrorCode,
    status?: number,
    rawBody?: string,
  ) {
    super(message);
    this.name = 'ChatBackendError';
    this.code = code;
    this.status = status;
    this.rawBody = rawBody;
  }
}
