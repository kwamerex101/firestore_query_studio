import { spawn, spawnSync } from 'node:child_process';
import type { ClaudeSettings } from '@shared/types/profile';
import type { ClaudeModelItem } from '@shared/types/ipc';
import type { ChatResponse, LlmMessage } from './openaiCompat';
import { LlmError } from './openaiCompat';

/**
 * Claude CLI adapter. Mirrors the Cursor CLI adapter's shape so the planner
 * can swap between them via the `LlmProvider` switch. Unlike Cursor's
 * `stream-json` transport, the Claude CLI (`claude -p --output-format json`)
 * emits a single JSON object on stdout when the turn finishes, which is
 * both simpler to parse and more robust to partial-write surprises.
 */

export interface ClaudeChatOptions {
  messages: LlmMessage[];
  timeoutMs?: number;
}

const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const VERSION_TIMEOUT_MS = 5_000;
const MODELS_CACHE_TTL_MS = 60_000;

/**
 * Built-in fallback list. The Claude CLI doesn't expose a `models` subcommand
 * at the time of writing, so we surface these aliases and full model ids so
 * users can pick something from the Settings dropdown even before the first
 * successful CLI round-trip. `auto` lets the CLI resolve its own default.
 */
export const CLAUDE_FALLBACK_MODELS: ReadonlyArray<ClaudeModelItem> = [
  { id: 'sonnet', label: 'Sonnet (alias)' },
  { id: 'opus', label: 'Opus (alias)' },
  { id: 'haiku', label: 'Haiku (alias)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

export const DEFAULT_CLAUDE_MODEL = 'sonnet';

function dedupeModels(models: ClaudeModelItem[]): ClaudeModelItem[] {
  const seen = new Set<string>();
  const out: ClaudeModelItem[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: (model.label || id).trim() });
  }
  return out;
}

function mergeEnv(envVars: Record<string, string>): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(envVars)) {
    if (typeof value === 'string') merged[key] = value;
  }
  return merged;
}

type ListModelsCache = { expiresAt: number; models: ClaudeModelItem[] };
let listModelsCache: ListModelsCache | null = null;

export function resetClaudeModelsCacheForTests(): void {
  listModelsCache = null;
}

/**
 * Returns the merged fallback list. We still go through an async helper so
 * the renderer's code path matches the Cursor one — future CLI versions may
 * expose a real `claude models` subcommand, and this is the single seam to
 * hook it into.
 */
export async function listClaudeModels(
  _settings: ClaudeSettings,
): Promise<{ models: ClaudeModelItem[]; source: 'cli' | 'fallback'; error?: string }> {
  const now = Date.now();
  if (listModelsCache && listModelsCache.expiresAt > now) {
    return { models: listModelsCache.models, source: 'fallback' };
  }
  const models = dedupeModels([...CLAUDE_FALLBACK_MODELS]);
  listModelsCache = { expiresAt: now + MODELS_CACHE_TTL_MS, models };
  return { models, source: 'fallback' };
}

export type ClaudeTestResult =
  | { ok: true; version?: string; stdout?: string }
  | { ok: false; code: string; message: string };

export async function testClaudeCli(settings: ClaudeSettings): Promise<ClaudeTestResult> {
  let result;
  try {
    result = spawnSync(settings.command, ['--version'], {
      encoding: 'utf8',
      timeout: VERSION_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      env: mergeEnv(settings.envVars ?? {}),
      cwd: settings.cwd && settings.cwd.length > 0 ? settings.cwd : undefined,
    });
  } catch (err) {
    return {
      ok: false,
      code: 'SPAWN_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    const code = err.code === 'ENOENT' ? 'NOT_FOUND' : 'SPAWN_ERROR';
    const message =
      err.code === 'ENOENT'
        ? `Command \`${settings.command}\` was not found on PATH. Install the Claude CLI (npm i -g @anthropic-ai/claude-code) or set the command path explicitly.`
        : err.message;
    return { ok: false, code, message };
  }

  if ((result.status ?? 1) !== 0) {
    return {
      ok: false,
      code: 'NON_ZERO_EXIT',
      message:
        stderr.trim() ||
        stdout.trim() ||
        `\`${settings.command} --version\` exited with code ${result.status ?? -1}`,
    };
  }

  const combined = `${stdout}\n${stderr}`;
  const version = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return { ok: true, version: version || undefined, stdout: stdout.trim() || undefined };
}

function messagesToPrompt(messages: LlmMessage[]): string {
  // The Claude CLI doesn't have a first-class system-message flag in
  // non-interactive mode, so we flatten messages into a single prompt using
  // the same `[role]` marker format the Cursor adapter uses. The planner
  // system prompt is strict enough that this round-trips losslessly.
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') parts.push(`[system]\n${m.content}`);
    else if (m.role === 'user') parts.push(`[user]\n${m.content}`);
    else parts.push(`[assistant]\n${m.content}`);
  }
  return parts.join('\n\n');
}

function buildArgs(settings: ClaudeSettings): string[] {
  const args = ['-p', '--output-format', 'json'];
  if (settings.model && settings.model.length > 0 && settings.model !== 'auto') {
    args.push('--model', settings.model);
  }
  if (settings.permissionMode && settings.permissionMode !== 'default') {
    args.push('--permission-mode', settings.permissionMode);
  }
  if (settings.extraArgs.length > 0) args.push(...settings.extraArgs);
  return args;
}

interface ClaudeCliResult {
  /** The assistant's text response. */
  result?: string;
  /** `true` when the CLI finished with an error, per its own reporting. */
  is_error?: boolean;
  /** Free-form error message (when present). */
  error?: unknown;
  /** Upstream fields we don't inspect but want to keep untouched for logs. */
  [key: string]: unknown;
}

function parseClaudeJsonOutput(stdout: string): {
  assistantText: string;
  errorMessage: string | null;
} {
  const trimmed = stdout.trim();
  if (!trimmed) return { assistantText: '', errorMessage: null };

  // The Claude CLI emits a single JSON object with `--output-format json`.
  // We still handle NDJSON defensively (stream-json mode or future changes)
  // by scanning each non-empty line and preferring the last `result`-shaped
  // object we find.
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let finalResult: ClaudeCliResult | null = null;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const rec = parsed as ClaudeCliResult;
      if (typeof rec.result === 'string' || rec.is_error || rec.error) {
        finalResult = rec;
      }
    } catch {
      // Ignore non-JSON lines (Claude CLI sometimes prints a banner on stderr;
      // stdout should always be pure JSON but we stay defensive).
    }
  }

  if (!finalResult) {
    // Fallback: try parsing the whole thing as one JSON object.
    try {
      const parsed = JSON.parse(trimmed) as ClaudeCliResult;
      finalResult = parsed;
    } catch {
      return { assistantText: '', errorMessage: null };
    }
  }

  const assistantText =
    typeof finalResult.result === 'string' ? finalResult.result.trim() : '';
  const errorMessage = finalResult.is_error
    ? readErrorText(finalResult.error ?? finalResult.result ?? 'Claude CLI reported an error')
    : null;
  return { assistantText, errorMessage };
}

function readErrorText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const rec = value as Record<string, unknown>;
  for (const k of ['message', 'error', 'code', 'detail']) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  try {
    return JSON.stringify(rec);
  } catch {
    return '';
  }
}

export async function chatViaClaude(
  settings: ClaudeSettings,
  opts: ClaudeChatOptions,
): Promise<ChatResponse> {
  const timeoutMs = Math.max(
    1_000,
    Math.min(600_000, opts.timeoutMs ?? settings.timeoutMs ?? 60_000),
  );
  const prompt = messagesToPrompt(opts.messages);
  const args = buildArgs(settings);
  const env = mergeEnv(settings.envVars ?? {});
  const cwd = settings.cwd && settings.cwd.length > 0 ? settings.cwd : undefined;

  return new Promise<ChatResponse>((resolve, reject) => {
    let child;
    try {
      child = spawn(settings.command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(
        new LlmError(
          `Failed to spawn Claude CLI \`${settings.command}\`: ${err instanceof Error ? err.message : String(err)}`,
          'NETWORK_ERROR',
        ),
      );
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const settleReject = (err: LlmError) => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // Already exited.
      }
      reject(err);
    };

    const settleResolve = (value: ChatResponse) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      settleReject(new LlmError(`Claude CLI timed out after ${timeoutMs}ms`, 'TIMEOUT'));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      const errno = err as NodeJS.ErrnoException;
      if (errno.code === 'ENOENT') {
        settleReject(
          new LlmError(
            `Claude CLI command \`${settings.command}\` was not found on PATH.`,
            'NETWORK_ERROR',
          ),
        );
        return;
      }
      settleReject(
        new LlmError(
          `Claude CLI spawn failed: ${err instanceof Error ? err.message : String(err)}`,
          'NETWORK_ERROR',
        ),
      );
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      const parsed = parseClaudeJsonOutput(stdout);

      if (code !== 0) {
        const message =
          parsed.errorMessage ||
          firstNonEmptyLine(stderr) ||
          firstNonEmptyLine(stdout) ||
          `Claude CLI exited with code ${code ?? -1}${signal ? ` (signal ${signal})` : ''}`;
        settleReject(
          new LlmError(message, 'HTTP_ERROR', code ?? undefined, `${stdout}\n${stderr}`),
        );
        return;
      }

      if (parsed.errorMessage && !parsed.assistantText) {
        settleReject(
          new LlmError(parsed.errorMessage, 'HTTP_ERROR', code ?? undefined, `${stdout}\n${stderr}`),
        );
        return;
      }

      if (!parsed.assistantText) {
        const hint = firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout) || '';
        settleReject(
          new LlmError(
            `Claude CLI produced no assistant output${hint ? `: ${hint}` : '.'}`,
            'PARSE_ERROR',
            code ?? undefined,
            `${stdout}\n${stderr}`,
          ),
        );
        return;
      }

      settleResolve({
        content: parsed.assistantText,
        rawBody: stdout,
        model: settings.model,
      });
    });

    try {
      child.stdin?.write(prompt);
      child.stdin?.end();
    } catch (err) {
      settleReject(
        new LlmError(
          `Failed to write prompt to Claude CLI stdin: ${err instanceof Error ? err.message : String(err)}`,
          'NETWORK_ERROR',
        ),
      );
    }
  });
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}
