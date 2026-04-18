import type { LlmProvider, LlmSettings, CursorSettings } from '@shared/types/profile';
import type { InsightsGenerateOutcome, InsightsGenerateRequest } from '@shared/types/ipc';
import type { ResultRow, RunOutcome } from '@shared/types/results';
import { chat, LlmError } from './openaiCompat';
import { chatViaCursor } from './cursorCli';
import { insightsSystemPrompt } from './prompts/insightsSystem';

export interface InsightsDeps {
  provider: LlmProvider;
  settings: LlmSettings | null;
  cursorSettings: CursorSettings | null;
}

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
      const sample = outcome.rows.slice(0, MAX_ROWS_IN_PROMPT).map(clipRowForPrompt);
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

export async function generateInsights(
  deps: InsightsDeps,
  req: InsightsGenerateRequest,
): Promise<InsightsGenerateOutcome> {
  const started = Date.now();
  const { text: userMsg, truncated } = buildUserMessage(req);
  const messages = [
    { role: 'system' as const, content: insightsSystemPrompt },
    { role: 'user' as const, content: userMsg },
  ];

  try {
    if (deps.provider === 'cursor-cli') {
      if (!deps.cursorSettings) {
        return {
          ok: false,
          code: 'CURSOR_NOT_CONFIGURED',
          message:
            'Cursor CLI provider is selected but no Cursor settings are saved. Configure it in the Cursor tab.',
        };
      }
      const timeoutMs = deps.cursorSettings.timeoutMs ?? 60_000;
      const response = await chatViaCursor(deps.cursorSettings, {
        messages,
        timeoutMs,
      });
      return {
        ok: true,
        insight: response.content.trim(),
        model: response.model,
        elapsedMs: Date.now() - started,
        rowSampleTruncated: truncated,
      };
    }

    if (!deps.settings || !deps.settings.apiKey) {
      return {
        ok: false,
        code: 'LLM_NOT_CONFIGURED',
        message:
          'Configure an LLM base URL and API key in Settings, or switch to the Cursor CLI provider.',
      };
    }
    const timeoutMs = deps.settings.timeoutMs ?? 30_000;
    // Insight generation is not as critical as planning, so keep retries low.
    const retries = timeoutMs >= 60_000 ? 0 : 1;
    const response = await chat(deps.settings, {
      messages,
      temperature: 0.2,
      timeoutMs,
      retries,
    });
    return {
      ok: true,
      insight: response.content.trim(),
      model: response.model,
      elapsedMs: Date.now() - started,
      rowSampleTruncated: truncated,
    };
  } catch (err) {
    if (err instanceof LlmError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return {
      ok: false,
      code: 'UNEXPECTED',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
