import { describe, expect, it } from 'vitest';
import { parseIndexHint } from '@main/firestore/indexLinkParser';

describe('parseIndexHint', () => {
  it('returns isIndexError=false for unrelated errors', () => {
    const err = new Error('PERMISSION_DENIED: some other thing');
    expect(parseIndexHint(err).isIndexError).toBe(false);
  });

  it('detects FAILED_PRECONDITION + requires an index, extracts URL', () => {
    const err = Object.assign(
      new Error(
        'FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/project/my-project/firestore/indexes?create_composite=abc123',
      ),
      { code: 'FAILED_PRECONDITION' },
    );
    const r = parseIndexHint(err);
    expect(r.isIndexError).toBe(true);
    expect(r.hint?.url).toBe(
      'https://console.firebase.google.com/project/my-project/firestore/indexes?create_composite=abc123',
    );
  });

  it('detects numeric gRPC code 9 (FAILED_PRECONDITION)', () => {
    const err = Object.assign(new Error('query needs an index'), { code: 9 });
    expect(parseIndexHint(err).isIndexError).toBe(true);
  });

  it('strips trailing punctuation from URL', () => {
    const err = new Error(
      'FAILED_PRECONDITION: create it at https://console.cloud.google.com/firestore/indexes?create_composite=xyz.',
    );
    const r = parseIndexHint(err);
    expect(r.hint?.url).toBe(
      'https://console.cloud.google.com/firestore/indexes?create_composite=xyz',
    );
  });

  it('accepts plain strings', () => {
    const r = parseIndexHint('FAILED_PRECONDITION: missing index');
    expect(r.isIndexError).toBe(true);
  });
});
