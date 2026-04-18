import type { LlmSettings, LlmProvider, CursorSettings } from '@shared/types/profile';
import type { CollectionSchema } from '@shared/types/schema';
import { QueryPlan } from '@shared/types/plan';
import type { PlanBuildOutcome, PlanRequest } from '@shared/types/ipc';
import { chat, LlmError } from './openaiCompat';
import { chatViaCursor } from './cursorCli';
import { queryPlanSystemPrompt } from './prompts/queryPlanSystem';

export interface PlannerDeps {
  provider: LlmProvider;
  settings: LlmSettings | null;
  cursorSettings: CursorSettings | null;
  schema?: CollectionSchema | null;
}

function buildUserMessage(req: PlanRequest, schema: CollectionSchema | null | undefined): string {
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
    parts.push('Schema snapshot: not available — infer field names from the question if you can.');
  }
  parts.push('');
  parts.push('Return ONE JSON object matching the QueryPlan schema. No prose, no markdown.');
  return parts.join('\n');
}

/**
 * Extracts the FIRST complete top-level JSON object from `text`. Handles:
 * - Plain `{...}` with no wrapping.
 * - Fenced ```json ... ``` blocks (we parse the fence contents the same way).
 * - Prose before the object ("Here is the plan: {...}").
 * - Trailing content after the object (second JSON blob, commentary, reasoning-channel wrappers).
 *
 * Walks the brace stack, respecting string literals and escape sequences, so
 * braces inside strings don't confuse the counter.
 */
function extractJsonObject(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenceMatch ? fenceMatch[1] : text).trim();

  const start = source.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

export async function buildPlan(
  deps: PlannerDeps,
  req: PlanRequest,
): Promise<PlanBuildOutcome> {
  try {
    const messages = [
      { role: 'system' as const, content: queryPlanSystemPrompt },
      { role: 'user' as const, content: buildUserMessage(req, deps.schema ?? null) },
    ];

    let response;
    if (deps.provider === 'cursor-cli') {
      if (!deps.cursorSettings) {
        return {
          ok: false,
          code: 'CURSOR_NOT_CONFIGURED',
          message:
            'Cursor CLI provider is selected but no Cursor settings are saved. Open the Cursor tab to configure it.',
        };
      }
      const timeoutMs = deps.cursorSettings.timeoutMs ?? 60_000;
      response = await chatViaCursor(deps.cursorSettings, {
        messages,
        timeoutMs,
      });
    } else {
      if (!deps.settings) {
        return {
          ok: false,
          code: 'LLM_NOT_CONFIGURED',
          message: 'Configure an LLM base URL and API key in settings before running queries.',
        };
      }
      const timeoutMs = deps.settings.timeoutMs ?? 30_000;
      // Long timeouts usually mean local models — retrying wastes minutes on
      // each failure and rarely helps, so back retries off as timeouts grow.
      const retries = timeoutMs >= 60_000 ? 0 : 2;
      response = await chat(deps.settings, {
        messages,
        temperature: 0,
        responseFormatJson: true,
        timeoutMs,
        retries,
      });
    }

    const jsonText = extractJsonObject(response.content);
    if (!jsonText) {
      logPlannerFailure('NO_JSON', response.content);
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
      logPlannerFailure('INVALID_JSON', response.content, jsonText);
      return {
        ok: false,
        code: 'INVALID_JSON',
        message: `LLM JSON could not be parsed: ${err instanceof Error ? err.message : String(err)}\nExtracted text (first 300 chars):\n${preview(jsonText, 300)}`,
        rawResponse: response.content,
      };
    }

    const validated = QueryPlan.safeParse(parsed);
    if (!validated.success) {
      logPlannerFailure('SCHEMA_VIOLATION', response.content, jsonText);
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
    if (err instanceof LlmError) {
      return {
        ok: false,
        code: err.code,
        message: err.message,
      };
    }
    return {
      ok: false,
      code: 'UNEXPECTED',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatZodError(error: { errors: Array<{ path: (string | number)[]; message: string }> }): string {
  return error.errors
    .slice(0, 5)
    .map((e) => `${e.path.join('.') || '<root>'}: ${e.message}`)
    .join('; ');
}

function preview(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncated, total ${text.length} chars]`;
}

function logPlannerFailure(code: string, raw: string, extracted?: string): void {
  // Main-process logging: appears in the terminal where `pnpm dev` is running.
  // eslint-disable-next-line no-console
  console.error(
    `\n[planner] ${code} — raw LLM response (${raw.length} chars):\n${raw}\n` +
      (extracted && extracted !== raw
        ? `[planner] extracted JSON text (${extracted.length} chars):\n${extracted}\n`
        : ''),
  );
}
