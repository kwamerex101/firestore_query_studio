import type { IndexHint } from '@shared/types/results';

/**
 * Firestore throws FAILED_PRECONDITION errors whose message includes a
 * "https://console.firebase.google.com/..." URL that, when opened, auto-fills
 * the composite-index builder for the missing index.
 *
 * We detect both the legacy console.cloud.google.com URLs and the firebase.google.com
 * URLs, and also detect the "requires an index" phrase even if no URL is included
 * (older SDK versions, some emulator paths) so we can still surface a useful hint.
 */

const URL_REGEX = /(https?:\/\/[^\s)]+)/i;
const REQUIRES_INDEX_REGEX = /(?:requires an index|needs an index|missing index)/i;
const FAILED_PRECONDITION_REGEX = /FAILED_PRECONDITION/i;

export interface ParseResult {
  isIndexError: boolean;
  hint?: IndexHint;
}

export function parseIndexHint(err: unknown): ParseResult {
  const message = extractMessage(err);
  const code = extractCode(err);
  const failedPrecondition =
    (typeof code === 'string' && code.toUpperCase() === 'FAILED_PRECONDITION') ||
    (typeof code === 'number' && code === 9) ||
    FAILED_PRECONDITION_REGEX.test(message);

  const requiresIndex = REQUIRES_INDEX_REGEX.test(message);
  if (!failedPrecondition && !requiresIndex) {
    return { isIndexError: false };
  }

  const urlMatch = message.match(URL_REGEX);
  const url = urlMatch ? sanitizeUrl(urlMatch[1]) : undefined;

  return {
    isIndexError: true,
    hint: {
      message: message || 'Firestore reported a missing composite index for this query.',
      url,
    },
  };
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message ?? '';
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === 'string' ? m : '';
  }
  return '';
}

function extractCode(err: unknown): string | number | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === 'string' || typeof c === 'number') return c;
  }
  return undefined;
}

function sanitizeUrl(url: string): string {
  // Strip trailing punctuation commonly present in error messages.
  return url.replace(/[.,;)]+$/, '');
}
