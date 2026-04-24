/**
 * Encode/decode a shareable query URL.
 *
 * Format: ?q=<base64url-encoded-question>&c=<base64url-encoded-collection>
 *
 * Uses URL-safe base64 (no padding) so the params survive copy-paste
 * without any extra escaping.
 */

export interface ShareParams {
  question: string;
  collection?: string;
}

function b64Encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64Decode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const base64 = pad ? padded + '='.repeat(4 - pad) : padded;
  return decodeURIComponent(escape(atob(base64)));
}

export function encodeShareUrl({ question, collection }: ShareParams): string {
  const params = new URLSearchParams();
  params.set('q', b64Encode(question));
  if (collection) params.set('c', b64Encode(collection));
  const base = window.location.origin + window.location.pathname;
  return `${base}?${params.toString()}`;
}

export function decodeShareUrl(search: string): ShareParams | null {
  try {
    const params = new URLSearchParams(search);
    const q = params.get('q');
    if (!q) return null;
    const c = params.get('c');
    return {
      question: b64Decode(q),
      collection: c ? b64Decode(c) : undefined,
    };
  } catch {
    return null;
  }
}
