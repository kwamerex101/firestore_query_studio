import { spawn, spawnSync } from 'node:child_process';
import type { CursorSettings } from '@shared/types/profile';
import type { CursorModelItem } from '@shared/types/ipc';
import type { ChatOptions, ChatResponse } from './openaiCompat';
import { LlmError } from './openaiCompat';

const MAX_BUFFER_BYTES = 1024 * 1024;
const MODELS_TIMEOUT_MS = 5_000;
const VERSION_TIMEOUT_MS = 5_000;
const MODELS_CACHE_TTL_MS = 60_000;

/**
 * Hard-coded fallback list ported verbatim from paperclip's
 * `packages/adapters/cursor-local/src/index.ts`. Used when the CLI is
 * unavailable or `agent models` cannot be parsed.
 */
export const CURSOR_FALLBACK_MODEL_IDS = [
  'auto',
  'composer-1.5',
  'composer-1',
  'gpt-5.3-codex-low',
  'gpt-5.3-codex-low-fast',
  'gpt-5.3-codex',
  'gpt-5.3-codex-fast',
  'gpt-5.3-codex-high',
  'gpt-5.3-codex-high-fast',
  'gpt-5.3-codex-xhigh',
  'gpt-5.3-codex-xhigh-fast',
  'gpt-5.3-codex-spark-preview',
  'gpt-5.2',
  'gpt-5.2-codex-low',
  'gpt-5.2-codex-low-fast',
  'gpt-5.2-codex',
  'gpt-5.2-codex-fast',
  'gpt-5.2-codex-high',
  'gpt-5.2-codex-high-fast',
  'gpt-5.2-codex-xhigh',
  'gpt-5.2-codex-xhigh-fast',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-max-high',
  'gpt-5.2-high',
  'gpt-5.1-high',
  'gpt-5.1-codex-mini',
  'opus-4.6-thinking',
  'opus-4.6',
  'opus-4.5',
  'opus-4.5-thinking',
  'sonnet-4.6',
  'sonnet-4.6-thinking',
  'sonnet-4.5',
  'sonnet-4.5-thinking',
  'gemini-3.1-pro',
  'gemini-3-pro',
  'gemini-3-flash',
  'grok',
  'kimi-k2.5',
] as const;

export const DEFAULT_CURSOR_LOCAL_MODEL = 'auto';

function dedupeModels(models: CursorModelItem[]): CursorModelItem[] {
  const seen = new Set<string>();
  const out: CursorModelItem[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: model.label.trim() || id });
  }
  return out;
}

function sanitizeModelId(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\(.*\)\s*$/g, '')
    .trim();
}

function isLikelyModelId(raw: string): boolean {
  const value = sanitizeModelId(raw);
  if (!value) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value);
}

function pushModelId(target: CursorModelItem[], raw: string): void {
  const id = sanitizeModelId(raw);
  if (!isLikelyModelId(id)) return;
  target.push({ id, label: id });
}

function collectFromJsonValue(value: unknown, target: CursorModelItem[]): void {
  if (typeof value === 'string') {
    pushModelId(target, value);
    return;
  }
  if (!Array.isArray(value)) return;

  for (const item of value) {
    if (typeof item === 'string') {
      pushModelId(target, item);
      continue;
    }
    if (typeof item !== 'object' || item === null) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id === 'string') pushModelId(target, id);
  }
}

/**
 * Parses `agent models` output. Handles three common shapes:
 * 1. A JSON array or `{ models: [...] }` object.
 * 2. A single line like `Available models: auto, gpt-5.3-codex, ...`.
 * 3. Bullet lists with one id per line (`- auto`, `* gpt-5.3-codex`, or bare ids).
 *
 * Mirrors paperclip's `parseCursorModelsOutput`.
 */
export function parseCursorModelsOutput(stdout: string, stderr: string): CursorModelItem[] {
  const models: CursorModelItem[] = [];
  const combined = `${stdout}\n${stderr}`;

  const trimmedStdout = stdout.trim();
  if (trimmedStdout.startsWith('{') || trimmedStdout.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmedStdout) as unknown;
      if (Array.isArray(parsed)) {
        collectFromJsonValue(parsed, models);
      } else if (typeof parsed === 'object' && parsed !== null) {
        const rec = parsed as Record<string, unknown>;
        collectFromJsonValue(rec.models, models);
        collectFromJsonValue(rec.data, models);
      }
    } catch {
      // Ignore malformed JSON; fall through to text parsing.
    }
  }

  for (const match of combined.matchAll(/available models?:\s*([^\n]+)/gi)) {
    const list = match[1] ?? '';
    for (const token of list.split(',')) pushModelId(models, token);
  }

  for (const lineRaw of combined.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) continue;
    const bullet = line.replace(/^[-*]\s+/, '').trim();
    if (!bullet || bullet.includes(' ')) continue;
    pushModelId(models, bullet);
  }

  return dedupeModels(models);
}

function mergedWithFallback(models: CursorModelItem[]): CursorModelItem[] {
  return dedupeModels([
    ...models,
    ...CURSOR_FALLBACK_MODEL_IDS.map((id) => ({ id, label: id })),
  ]);
}

function fallbackModels(): CursorModelItem[] {
  return CURSOR_FALLBACK_MODEL_IDS.map((id) => ({ id, label: id }));
}

function mergeEnv(envVars: Record<string, string>): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(envVars)) {
    if (typeof value === 'string') merged[key] = value;
  }
  return merged;
}

type ListModelsCache = { expiresAt: number; models: CursorModelItem[] };
let listModelsCache: ListModelsCache | null = null;

export function resetCursorModelsCacheForTests(): void {
  listModelsCache = null;
}

export async function listCursorModels(
  settings: CursorSettings,
): Promise<{ models: CursorModelItem[]; source: 'cli' | 'fallback'; error?: string }> {
  const now = Date.now();
  if (listModelsCache && listModelsCache.expiresAt > now) {
    return { models: listModelsCache.models, source: 'cli' };
  }

  let result;
  try {
    result = spawnSync(settings.command, ['models'], {
      encoding: 'utf8',
      timeout: MODELS_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      env: mergeEnv(settings.envVars ?? {}),
      cwd: settings.cwd && settings.cwd.length > 0 ? settings.cwd : undefined,
    });
  } catch (err) {
    return {
      models: fallbackModels(),
      source: 'fallback',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (result.error && stdout.trim().length === 0 && stderr.trim().length === 0) {
    return {
      models: fallbackModels(),
      source: 'fallback',
      error: result.error.message,
    };
  }

  const status = result.status ?? 1;
  if (status !== 0 && !/available models?:/i.test(`${stdout}\n${stderr}`)) {
    return {
      models: fallbackModels(),
      source: 'fallback',
      error:
        stderr.trim() ||
        stdout.trim() ||
        `\`${settings.command} models\` exited with code ${status}`,
    };
  }

  const parsed = parseCursorModelsOutput(stdout, stderr);
  if (parsed.length === 0) {
    return { models: fallbackModels(), source: 'fallback' };
  }

  const merged = mergedWithFallback(parsed);
  listModelsCache = { expiresAt: now + MODELS_CACHE_TTL_MS, models: merged };
  return { models: merged, source: 'cli' };
}

export type CursorTestResult =
  | { ok: true; version?: string; stdout?: string }
  | { ok: false; code: string; message: string };

export async function testCursorCli(settings: CursorSettings): Promise<CursorTestResult> {
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
        ? `Command \`${settings.command}\` was not found on PATH. Install the Cursor Agent CLI or set the command path explicitly.`
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

function messagesToPrompt(messages: ChatOptions['messages']): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      parts.push(`[system]\n${m.content}`);
    } else if (m.role === 'user') {
      parts.push(`[user]\n${m.content}`);
    } else {
      parts.push(`[assistant]\n${m.content}`);
    }
  }
  return parts.join('\n\n');
}

function buildArgs(settings: CursorSettings): string[] {
  const args = ['-p', '--output-format', 'stream-json'];
  if (settings.cwd && settings.cwd.length > 0) {
    args.push('--workspace', settings.cwd);
  }
  if (settings.model && settings.model.length > 0) {
    args.push('--model', settings.model);
  }
  if (settings.mode === 'plan' || settings.mode === 'ask') {
    args.push('--mode', settings.mode);
  }
  const hasTrustBypass = settings.extraArgs.some(
    (a) => a === '--yolo' || a === '--trust' || a === '-f',
  );
  if (!hasTrustBypass) args.push('--yolo');
  if (settings.extraArgs.length > 0) args.push(...settings.extraArgs);
  return args;
}

type ParsedJsonl = {
  assistantText: string;
  errorMessage: string | null;
};

/**
 * Minimal port of paperclip's `parseCursorJsonl`, scoped to what the planner
 * needs: concatenated assistant text plus any reported error.
 */
function parseStreamJsonl(stdout: string): ParsedJsonl {
  const messages: string[] = [];
  let errorMessage: string | null = null;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      event = parsed as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = typeof event.type === 'string' ? event.type.trim() : '';

    if (type === 'assistant') {
      pushAssistantText(messages, event.message);
      continue;
    }

    if (type === 'result') {
      const isError =
        event.is_error === true ||
        (typeof event.subtype === 'string' && event.subtype.trim().toLowerCase() === 'error');
      const resultText = typeof event.result === 'string' ? event.result.trim() : '';
      if (resultText && messages.length === 0) messages.push(resultText);
      if (isError) {
        const msg = readErrorText(event.error ?? event.message ?? event.result);
        if (msg) errorMessage = msg;
      }
      continue;
    }

    if (type === 'error') {
      const msg = readErrorText(event.message ?? event.error ?? event.detail);
      if (msg) errorMessage = msg;
      continue;
    }

    if (type === 'system') {
      const subtype = typeof event.subtype === 'string' ? event.subtype.trim().toLowerCase() : '';
      if (subtype === 'error') {
        const msg = readErrorText(event.message ?? event.error ?? event.detail);
        if (msg) errorMessage = msg;
      }
      continue;
    }

    if (type === 'text') {
      const part = event.part;
      if (part && typeof part === 'object' && !Array.isArray(part)) {
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string' && text.trim()) messages.push(text.trim());
      }
      continue;
    }
  }

  return { assistantText: messages.join('\n\n').trim(), errorMessage };
}

function pushAssistantText(target: string[], message: unknown): void {
  if (typeof message === 'string') {
    const trimmed = message.trim();
    if (trimmed) target.push(trimmed);
    return;
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) return;
  const rec = message as Record<string, unknown>;
  if (typeof rec.text === 'string' && rec.text.trim()) target.push(rec.text.trim());
  const content = rec.content;
  if (!Array.isArray(content)) return;
  for (const partRaw of content) {
    if (!partRaw || typeof partRaw !== 'object' || Array.isArray(partRaw)) continue;
    const part = partRaw as Record<string, unknown>;
    const type = typeof part.type === 'string' ? part.type.trim() : '';
    if (type !== 'output_text' && type !== 'text') continue;
    const text = part.text;
    if (typeof text === 'string' && text.trim()) target.push(text.trim());
  }
}

function readErrorText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const rec = value as Record<string, unknown>;
  const candidates = ['message', 'error', 'code', 'detail'];
  for (const k of candidates) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  try {
    return JSON.stringify(rec);
  } catch {
    return '';
  }
}

export async function chatViaCursor(
  settings: CursorSettings,
  opts: ChatOptions,
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
          `Failed to spawn Cursor CLI \`${settings.command}\`: ${err instanceof Error ? err.message : String(err)}`,
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
        // Ignore kill errors; the child has already exited.
      }
      reject(err);
    };

    const settleResolve = (value: ChatResponse) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      settleReject(new LlmError(`Cursor CLI timed out after ${timeoutMs}ms`, 'TIMEOUT'));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      const errno = err as NodeJS.ErrnoException;
      if (errno.code === 'ENOENT') {
        settleReject(
          new LlmError(
            `Cursor CLI command \`${settings.command}\` was not found on PATH.`,
            'NETWORK_ERROR',
          ),
        );
        return;
      }
      settleReject(
        new LlmError(
          `Cursor CLI spawn failed: ${err instanceof Error ? err.message : String(err)}`,
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

      const parsed = parseStreamJsonl(stdout);

      if (code !== 0) {
        const message =
          parsed.errorMessage ||
          firstNonEmptyLine(stderr) ||
          firstNonEmptyLine(stdout) ||
          `Cursor CLI exited with code ${code ?? -1}${signal ? ` (signal ${signal})` : ''}`;
        settleReject(
          new LlmError(message, 'HTTP_ERROR', code ?? undefined, `${stdout}\n${stderr}`),
        );
        return;
      }

      if (!parsed.assistantText) {
        const hint = firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout) || '';
        settleReject(
          new LlmError(
            `Cursor CLI produced no assistant output${hint ? `: ${hint}` : '.'}`,
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
          `Failed to write prompt to Cursor CLI stdin: ${err instanceof Error ? err.message : String(err)}`,
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
