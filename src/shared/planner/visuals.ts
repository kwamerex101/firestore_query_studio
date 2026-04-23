import type {
  SqlRow,
  VisualsGenerateOutcome,
  VisualsGenerateRequest,
} from '@shared/types/ipc';
import type { ResultRow } from '@shared/types/results';
import { parseVisualPlanLenient } from '@shared/types/visualPlan';
import { extractJsonObject } from './jsonExtract';
import { visualsSystemPrompt } from './prompts/visualsSystem';
import {
  ChatBackendError,
  type ChatBackend,
  type LlmMessage,
} from './types';

/** Cap rows in the prompt — same budget as insights. */
const MAX_ROWS_IN_PROMPT = 40;
const MAX_ROW_CHARS = 1500;

export interface GenerateVisualsDeps {
  chat: ChatBackend;
  chatOptionsOverrides?: {
    temperature?: number;
    timeoutMs?: number;
    retries?: number;
    responseFormatJson?: boolean;
  };
}

function clipFirestoreRow(row: ResultRow): ResultRow {
  const json = JSON.stringify(row);
  if (json.length <= MAX_ROW_CHARS) return row;
  const clipped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row.data)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    clipped[k] = s && s.length > 200 ? `${s.slice(0, 200)}… [truncated]` : v;
  }
  return { id: row.id, path: row.path, data: clipped };
}

function clipSqlRow(row: SqlRow): SqlRow {
  const json = JSON.stringify(row);
  if (json.length <= MAX_ROW_CHARS) return row;
  const clipped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    clipped[k] = s && s.length > 200 ? `${s.slice(0, 200)}… [truncated]` : v;
  }
  return clipped as SqlRow;
}

function buildUserMessage(req: VisualsGenerateRequest): {
  text: string;
  truncated: boolean;
} {
  const parts: string[] = [];
  parts.push(`User question:\n${req.question}`);
  let truncated = false;

  if (req.source === 'firestore') {
    if (req.collection) parts.push(`Target collection: ${req.collection}`);
    parts.push(`Executed plan:\n${JSON.stringify(req.plan, null, 2)}`);
    const outcome = req.outcome;
    if (outcome.ok) {
      const s = outcome.stats;
      parts.push(
        `Run stats: mode=${s.mode}, scanned=${s.scanned}, matched=${s.matched}, returned=${s.returned}, durationMs=${Math.round(s.durationMs)}${s.truncated ? ', truncated=true' : ''}`,
      );
      if (outcome.warnings.length) {
        parts.push(`Warnings:\n- ${outcome.warnings.join('\n- ')}`);
      }
      if (outcome.rows.length === 0) {
        parts.push('Rows: (empty result set) — return { "specs": [] }.');
      } else {
        const sample = outcome.rows
          .slice(0, MAX_ROWS_IN_PROMPT)
          .map(clipFirestoreRow);
        truncated = outcome.rows.length > sample.length;
        parts.push(
          `Rows (${sample.length} of ${outcome.rows.length}${truncated ? '; remainder omitted' : ''}):\n${JSON.stringify(sample, null, 2)}`,
        );
      }
    } else {
      parts.push(
        `Run FAILED with code ${outcome.code}.\nMessage:\n${outcome.message}`,
      );
      parts.push(
        'Because the query failed, return { "specs": [] } with an optional narrative.',
      );
    }
  } else {
    parts.push(`Executed SQL:\n${req.sql}`);
    parts.push(
      `Columns:\n${JSON.stringify(req.columns.map((c) => ({ name: c.name, dataType: c.dataType })), null, 2)}`,
    );
    if (req.rows.length === 0) {
      parts.push('Rows: (empty result set) — return { "specs": [] }.');
    } else {
      const sample = req.rows.slice(0, MAX_ROWS_IN_PROMPT).map(clipSqlRow);
      truncated = req.rows.length > sample.length || req.truncated;
      parts.push(
        `Rows (${sample.length} of ${req.rows.length}${truncated ? '; remainder/driver-truncated' : ''}):\n${JSON.stringify(sample, null, 2)}`,
      );
    }
  }

  parts.push(
    'Return a single JSON object matching the VisualPlan DSL. No prose, no markdown fences.',
  );
  return { text: parts.join('\n\n'), truncated };
}

/**
 * Generate a chart-spec plan from a completed query. Shell-agnostic — the
 * caller supplies a `ChatBackend`. The response is parsed leniently so a
 * single malformed spec doesn't discard the whole set.
 */
export async function generateVisuals(
  deps: GenerateVisualsDeps,
  req: VisualsGenerateRequest,
): Promise<VisualsGenerateOutcome> {
  const started = Date.now();
  const { text: userMsg, truncated } = buildUserMessage(req);
  const messages: LlmMessage[] = [
    { role: 'system', content: visualsSystemPrompt },
    { role: 'user', content: userMsg },
  ];

  try {
    const response = await deps.chat(messages, {
      temperature: deps.chatOptionsOverrides?.temperature ?? 0.2,
      timeoutMs: deps.chatOptionsOverrides?.timeoutMs,
      retries: deps.chatOptionsOverrides?.retries,
      responseFormatJson:
        deps.chatOptionsOverrides?.responseFormatJson ?? true,
    });
    const jsonText = extractJsonObject(response.content);
    if (!jsonText) {
      return {
        ok: false,
        code: 'NO_JSON',
        message: `LLM response did not contain a JSON object. First 300 chars:\n${preview(response.content, 300)}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      return {
        ok: false,
        code: 'INVALID_JSON',
        message: `LLM JSON could not be parsed: ${err instanceof Error ? err.message : String(err)}\nExtracted (first 300 chars):\n${preview(jsonText, 300)}`,
      };
    }
    const { plan, dropped } = parseVisualPlanLenient(parsed);
    return {
      ok: true,
      plan,
      model: response.model,
      elapsedMs: Date.now() - started,
      rowSampleTruncated: truncated,
      specsDropped: dropped,
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

function preview(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncated, total ${text.length} chars]`;
}
