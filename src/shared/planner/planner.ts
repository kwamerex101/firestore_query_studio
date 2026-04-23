import type { CollectionSchema } from '@shared/types/schema';
import { QueryPlan } from '@shared/types/plan';
import type { PlanBuildOutcome, PlanRequest } from '@shared/types/ipc';
import { extractJsonObject } from './jsonExtract';
import { queryPlanSystemPrompt } from './prompts/queryPlanSystem';
import {
  ChatBackendError,
  type ChatBackend,
  type LlmMessage,
} from './types';

export interface BuildPlanDeps {
  /**
   * Transport-agnostic chat function — Electron main wraps the openai-compat
   * or Cursor-CLI backend, the web shell wraps a BYOK `fetch` call. Either
   * way, the shared planner only sees `(messages, opts) => Promise<response>`.
   */
  chat: ChatBackend;
  /**
   * Override the chat options the planner requests. We default to
   * `temperature: 0` + `responseFormatJson: true` because deterministic JSON
   * is what downstream parsing expects, but backends that can't honour those
   * knobs (e.g. Cursor CLI) can drop them inside their own wrapper.
   */
  chatOptionsOverrides?: {
    temperature?: number;
    timeoutMs?: number;
    retries?: number;
    responseFormatJson?: boolean;
  };
  schema?: CollectionSchema | null;
  /** Optional hook so shells can log failures consistently (main uses console.error). */
  onFailure?: (
    code: 'NO_JSON' | 'INVALID_JSON' | 'SCHEMA_VIOLATION',
    raw: string,
    extracted?: string,
  ) => void;
}

function buildUserMessage(
  req: PlanRequest,
  schema: CollectionSchema | null | undefined,
): string {
  const parts: string[] = [];
  parts.push(`User question: ${req.question}`);
  if (req.collection) parts.push(`Target collection: ${req.collection}`);
  parts.push(`Allow scan mode: ${req.allowScan}`);
  parts.push(`Allow multi mode: ${req.allowMulti}`);
  if (schema) {
    parts.push('');
    parts.push(`Schema snapshot (sampled ${schema.sampledCount} docs):`);
    parts.push(
      JSON.stringify(
        {
          collection: schema.collection,
          collectionGroup: schema.collectionGroup,
          fields: schema.fields.map((f) => ({
            name: f.name,
            types: f.types,
            occurrences: f.occurrences,
            examples: f.examples.slice(0, 2),
          })),
          userOverride: schema.userOverride ?? null,
          userNotes: schema.userNotes ?? null,
        },
        null,
        2,
      ),
    );
  } else {
    parts.push('');
    parts.push(
      'Schema snapshot: not available — infer field names from the question if you can.',
    );
  }
  parts.push('');
  parts.push(
    'Return ONE JSON object matching the QueryPlan schema. No prose, no markdown.',
  );
  return parts.join('\n');
}

/**
 * Build a Firestore query plan from a natural-language request. The planner
 * itself is pure and shell-agnostic — the caller passes in a `ChatBackend`
 * that knows how to talk to their chosen LLM.
 */
export async function buildPlan(
  deps: BuildPlanDeps,
  req: PlanRequest,
): Promise<PlanBuildOutcome> {
  try {
    const messages: LlmMessage[] = [
      { role: 'system', content: queryPlanSystemPrompt },
      { role: 'user', content: buildUserMessage(req, deps.schema ?? null) },
    ];

    const response = await deps.chat(messages, {
      temperature: deps.chatOptionsOverrides?.temperature ?? 0,
      responseFormatJson:
        deps.chatOptionsOverrides?.responseFormatJson ?? true,
      timeoutMs: deps.chatOptionsOverrides?.timeoutMs,
      retries: deps.chatOptionsOverrides?.retries,
    });

    const jsonText = extractJsonObject(response.content);
    if (!jsonText) {
      deps.onFailure?.('NO_JSON', response.content);
      return {
        ok: false,
        code: 'NO_JSON',
        message: `LLM response did not contain a JSON object. First 300 chars:\n${preview(response.content, 300)}`,
        rawResponse: response.content,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      deps.onFailure?.('INVALID_JSON', response.content, jsonText);
      return {
        ok: false,
        code: 'INVALID_JSON',
        message: `LLM JSON could not be parsed: ${err instanceof Error ? err.message : String(err)}\nExtracted text (first 300 chars):\n${preview(jsonText, 300)}`,
        rawResponse: response.content,
      };
    }

    const validated = QueryPlan.safeParse(parsed);
    if (!validated.success) {
      deps.onFailure?.('SCHEMA_VIOLATION', response.content, jsonText);
      return {
        ok: false,
        code: 'SCHEMA_VIOLATION',
        message: `Plan failed validation: ${formatZodError(validated.error)}`,
        rawResponse: response.content,
      };
    }

    return {
      ok: true,
      plan: validated.data,
      rawResponse: response.content,
    };
  } catch (err) {
    if (err instanceof ChatBackendError) {
      return {
        ok: false,
        code: err.code,
        message: err.message,
      };
    }
    // Shells may throw their own typed errors (e.g. a main-process LlmError
    // that aliases ChatBackendError). We forward `.code` if it looks like one.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      typeof (err as { code: unknown }).code === 'string'
    ) {
      const e = err as { code: string; message?: string };
      return {
        ok: false,
        code: e.code,
        message: e.message ?? String(err),
      };
    }
    return {
      ok: false,
      code: 'UNEXPECTED',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatZodError(error: {
  errors: Array<{ path: (string | number)[]; message: string }>;
}): string {
  return error.errors
    .slice(0, 5)
    .map((e) => `${e.path.join('.') || '<root>'}: ${e.message}`)
    .join('; ');
}

function preview(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncated, total ${text.length} chars]`;
}
