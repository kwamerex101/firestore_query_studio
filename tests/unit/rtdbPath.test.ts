import { describe, expect, it } from 'vitest';
import {
  jsonSafeRtdbValue,
  MAX_RTDB_JSON_BYTES,
  normalizeRtdbPath,
} from '@main/drivers/rtdb';

describe('normalizeRtdbPath', () => {
  it('normalizes root and shallow paths', () => {
    expect(normalizeRtdbPath('')).toBe('/');
    expect(normalizeRtdbPath('/')).toBe('/');
    expect(normalizeRtdbPath('users/foo')).toBe('/users/foo');
  });

  it('rejects dot segments', () => {
    expect(() => normalizeRtdbPath('/a/../b')).toThrow();
  });
});

describe('jsonSafeRtdbValue', () => {
  it('rejects values over byte budget', () => {
    const big = 'x'.repeat(MAX_RTDB_JSON_BYTES + 1);
    expect(() => jsonSafeRtdbValue({ x: big })).toThrow(/exceeds limit/);
  });
});
