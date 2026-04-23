import { z } from 'zod';
import type { SqlDialect } from '@shared/types/profile';
import { SqlPlan, type SqlTableSampleView } from '@shared/types/sqlPlan';
import { validateReadOnlySql } from '@shared/sqlSafety';
import { extractJsonObject } from './jsonExtract';
import { sqlQueryPlanSystemPrompt } from './prompts/sqlQueryPlanSystem';
import {
  ChatBackendError,
  type ChatBackend,
  type LlmMessage,
} from './types';

export interface SqlPlanRequest {
  question: string;
  dialect: SqlDialect;
  /** Zero-based; the planner uses a tiny sample per table to stay within token budgets. */
  schemaSample?: SqlTableSampleView[] | null;
  /** Profile's row cap; forwarded into the prompt so the planner doesn't ask for more. */
  defaultLimit?: number;
}

export const SqlPlanBuildOk = z.object({
  ok: z.literal(true),
  plan: SqlPlan,
  rawResponse: z.string().optional(),
});
export const SqlPlanBuildErr = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  rawResponse: z.string().optional(),
});
export const SqlPlanBuildOutcome = z.discriminatedUnion('ok', [
  SqlPlanBuildOk,
  SqlPlanBuildErr,
]);
export type SqlPlanBuildOutcome = z.infer<typeof SqlPlanBuildOutcome>;

export interface BuildSqlPlanDeps {
  chat: ChatBackend;
  chatOptionsOverrides?: {
    temperature?: number;
    timeoutMs?: number;
    retries?: number;
    responseFormatJson?: boolean;
  };
  onFailure?: (
    code:
      | 'NO_JSON'
      | 'INVALID_JSON'
      | 'SCHEMA_VIOLATION'
      | 'UNSAFE_SQL'
      | 'DIALECT_MISMATCH',
    raw: string,
    extracted?: string,
  ) => void;
}

function buildUserMessage(req: SqlPlanRequest): string {
  const parts: string[] = [];
  parts.push(`User question: ${req.question}`);
  parts.push(`Dialect: ${req.dialect}`);
  if (typeof req.defaultLimit === 'number') {
    parts.push(`Row cap: ${req.defaultLimit}`);
  }
  const samples = req.schemaSample ?? [];
  if (samples.length > 0) {
    parts.push('');
    parts.push('Schema snapshot:');
    parts.push(
      JSON.stringify(
        samples.map((s) => ({
          schema: s.schema,
          table: s.table,
          columns: s.columns.map((c) => ({
            name: c.name,
            dataType: c.dataType,
            isNullable: c.isNullable,
          })),
          // Up to 2 example rows per table keeps the prompt small while
          // still giving the planner a hint at value shapes.
          examples: s.rows.slice(0, 2),
        })),
        null,
        2,
      ),
    );
  } else {
    parts.push('');
    parts.push('Schema snapshot: not available — rely on the question for column names.');
  }
  parts.push('');
  parts.push('Return ONE JSON object matching the SqlPlan schema. No prose, no markdown.');
  return parts.join('\n');
}

/**
 * Build a SQL query plan from a natural-language request. Pure and shell-
 * agnostic, same as `buildPlan`: the caller hands us a `ChatBackend` and
 * we hand back a structured outcome. The returned `plan.sql` has been
 * re-validated against `sqlSafety` before this function resolves, so the
 * renderer can trust it is single-statement and read-only.
 */
export async function buildSqlPlan(
  deps: BuildSqlPlanDeps,
  req: SqlPlanRequest,
): Promise<SqlPlanBuildOutcome> {
  try {
    const messages: LlmMessage[] = [
      { role: 'system', content: sqlQueryPlanSystemPrompt(req.dialect) },
      { role: 'user', content: buildUserMessage(req) },
    ];
    const response = await deps.chat(messages, {
      temperature: deps.chatOptionsOverrides?.temperature ?? 0,
      responseFormatJson: deps.chatOptionsOverrides?.responseFormatJson ?? true,
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
    const validated = SqlPlan.safeParse(parsed);
    if (!validated.success) {
      deps.onFailure?.('SCHEMA_VIOLATION', response.content, jsonText);
      return {
        ok: false,
        code: 'SCHEMA_VIOLATION',
        message: `SQL plan failed validation: ${formatZodError(validated.error)}`,
        rawResponse: response.content,
      };
    }
    if (validated.data.dialect !== req.dialect) {
      deps.onFailure?.('DIALECT_MISMATCH', response.content, jsonText);
      return {
        ok: false,
        code: 'DIALECT_MISMATCH',
        message: `Planner produced a ${validated.data.dialect} plan, but the active profile is ${req.dialect}.`,
        rawResponse: response.content,
      };
    }
    const safety = validateReadOnlySql(validated.data.sql);
    if (!safety.ok) {
      deps.onFailure?.('UNSAFE_SQL', response.content, jsonText);
      return {
        ok: false,
        code: `UNSAFE_SQL:${safety.code}`,
        message: `Planner emitted an unsafe statement: ${safety.message}`,
        rawResponse: response.content,
      };
    }
    return {
      ok: true,
      plan: { ...validated.data, sql: safety.normalized },
      rawResponse: response.content,
    };
  } catch (err) {
    if (err instanceof ChatBackendError) {
      return { ok: false, code: err.code, message: err.message };
    }
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      typeof (err as { code: unknown }).code === 'string'
    ) {
      const e = err as { code: string; message?: string };
      return { ok: false, code: e.code, message: e.message ?? String(err) };
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
