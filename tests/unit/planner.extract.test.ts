import { describe, expect, it } from 'vitest';
import { extractJsonObject } from '@shared/planner';

// `extractJsonObject` now lives in `src/shared/planner/jsonExtract.ts` and is
// exported directly, so this test imports it for real instead of re-implementing
// the contract.

describe('extractJsonObject', () => {
  it('returns the trimmed text when it is a single JSON object', () => {
    const input = '{"mode":"query","collection":"users","rationale":"x"}';
    expect(extractJsonObject(input)).toBe(input);
  });

  it('returns ONLY the first object when two objects are concatenated', () => {
    const input =
      '{"mode":"query","collection":"users","rationale":"x"}{"second":true}';
    expect(extractJsonObject(input)).toBe(
      '{"mode":"query","collection":"users","rationale":"x"}',
    );
  });

  it('strips prose before the object', () => {
    const input =
      'Here is the plan: {"mode":"query","collection":"users","rationale":"x"}';
    expect(extractJsonObject(input)).toBe(
      '{"mode":"query","collection":"users","rationale":"x"}',
    );
  });

  it('strips trailing prose after the object', () => {
    const input =
      '{"mode":"query","collection":"users","rationale":"x"}\nLet me know if you need changes.';
    expect(extractJsonObject(input)).toBe(
      '{"mode":"query","collection":"users","rationale":"x"}',
    );
  });

  it('unwraps ```json fenced blocks', () => {
    const input =
      '```json\n{"mode":"query","collection":"users","rationale":"x"}\n```';
    expect(extractJsonObject(input)).toBe(
      '{"mode":"query","collection":"users","rationale":"x"}',
    );
  });

  it('handles nested objects correctly', () => {
    const input =
      '{"mode":"multi","rationale":"x","steps":[{"mode":"query","collection":"u","rationale":"y"}]}';
    expect(extractJsonObject(input)).toBe(input);
  });

  it('does not get confused by braces inside string literals', () => {
    const input = '{"rationale":"has a } brace inside","mode":"query","collection":"u"}';
    expect(extractJsonObject(input)).toBe(input);
  });

  it('handles escaped quotes inside strings', () => {
    const input = '{"rationale":"she said \\"{}\\"","mode":"query","collection":"u"}';
    expect(extractJsonObject(input)).toBe(input);
  });

  it('returns null when there is no object at all', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });

  it('handles reasoning-channel wrappers followed by the real plan', () => {
    const input =
      '{"channel":"reasoning"}\n{"mode":"query","collection":"users","rationale":"x"}';
    expect(extractJsonObject(input)).toBe('{"channel":"reasoning"}');
  });
});
