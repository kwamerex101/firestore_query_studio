import type {
  InsightsGenerateOutcome,
  InsightsGenerateRequest,
} from '@shared/types/ipc';
import type { ResultRow, RunOutcome } from '@shared/types/results';
import { insightsSystemPrompt } from './prompts/insightsSystem';
import {
  ChatBackendError,
  type ChatBackend,
  type LlmMessage,
} from './types';

/**
 * We cap the rows sent to the LLM to keep prompts within context limits
 * and to keep latency + cost reasonable. 40 is enough to spot patterns
 * without blowing the context window on typical OpenAI-compat models.
 */
const MAX_ROWS_IN_PROMPT = 40;

/**
 * Per-row string cap so a single pathological document (e.g. huge base64
 * blob) can't dominate the prompt. Characters, not bytes — close enough
 * for context budgeting.
 */
const MAX_ROW_CHARS = 1500;

export interface GenerateInsightsDeps {
  chat: ChatBackend;
  chatOptionsOverrides?: {
    temperature?: number;
    timeoutMs?: number;
    retries?: number;
  };
}

function clipRowForPrompt(row: ResultRow): ResultRow {
  const json = JSON.stringify(row);
  if (json.length <= MAX_ROW_CHARS) return row;
  // Re-stringify with per-field truncation if an individual doc exceeds
  // the budget. We keep the id/path intact because they're identity.
  const clipped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row.data)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    clipped[k] = s && s.length > 200 ? `${s.slice(0, 200)}… [truncated]` : v;
  }
  return { id: row.id, path: row.path, data: clipped };
}

function buildUserMessage(req: InsightsGenerateRequest): {
  text: string;
  truncated: boolean;
} {
  const parts: string[] = [];
  parts.push(`User question:\n${req.question}`);
  if (req.collection) {
    parts.push(`Target collection: ${req.collection}`);
  }
  parts.push(`Executed plan:\n${JSON.stringify(req.plan, null, 2)}`);

  const outcome: RunOutcome = req.outcome;
  let truncated = false;
  if (outcome.ok) {
    const stats = outcome.stats;
    parts.push(
      `Run stats: mode=${stats.mode}, scanned=${stats.scanned}, matched=${stats.matched}, returned=${stats.returned}, durationMs=${Math.round(stats.durationMs)}${stats.truncated ? ', truncated=true' : ''}`,
    );
    if (outcome.warnings.length) {
      parts.push(`Warnings:\n- ${outcome.warnings.join('\n- ')}`);
    }
    if (outcome.rows.length === 0) {
      parts.push('Rows: (empty result set)');
    } else {
      const sample = outcome.rows
        .slice(0, MAX_ROWS_IN_PROMPT)
        .map(clipRowForPrompt);
      truncated = outcome.rows.length > sample.length;
      parts.push(
        `Rows (${sample.length} of ${outcome.rows.length}${truncated ? '; remainder omitted for brevity' : ''}):\n${JSON.stringify(sample, null, 2)}`,
      );
    }
  } else {
    parts.push(
      `Run FAILED with code ${outcome.code}.\nMessage:\n${outcome.message}`,
    );
    if (outcome.indexHint?.url) {
      parts.push(`Firestore index-creation URL: ${outcome.indexHint.url}`);
    }
    if (outcome.warnings.length) {
      parts.push(`Warnings:\n- ${outcome.warnings.join('\n- ')}`);
    }
  }

  parts.push(
    'Produce the markdown analysis now, following the rules in the system prompt.',
  );
  return { text: parts.join('\n\n'), truncated };
}

/**
 * Summarise a Firestore query run into a short markdown analysis. Like
 * `buildPlan`, the caller supplies a `ChatBackend` so this function runs on
 * both Electron main and the web shell without changes.
 */
export async function generateInsights(
  deps: GenerateInsightsDeps,
  req: InsightsGenerateRequest,
): Promise<InsightsGenerateOutcome> {
  const started = Date.now();
  const { text: userMsg, truncated } = buildUserMessage(req);
  const messages: LlmMessage[] = [
    { role: 'system', content: insightsSystemPrompt },
    { role: 'user', content: userMsg },
  ];

  try {
    const response = await deps.chat(messages, {
      temperature: deps.chatOptionsOverrides?.temperature ?? 0.2,
      timeoutMs: deps.chatOptionsOverrides?.timeoutMs,
      retries: deps.chatOptionsOverrides?.retries,
    });
    return {
      ok: true,
      insight: response.content.trim(),
      model: response.model,
      elapsedMs: Date.now() - started,
      rowSampleTruncated: truncated,
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
