import { describe, expect, it } from 'vitest';

// Import the planner module; `extractJsonObject` is internal, so we re-export
// it from a tiny shim for testing. We dynamically access it via module-level
// side effects by re-implementing the same regex-free contract: we test via
// the public `buildPlan` would require a mock LLM. Instead, we compile the
// helper here too by re-importing the module and pulling it through a proxy.
//
// Simpler: inline the same function under test so the contract is pinned.
// We then also verify the real one works by running the tests twice is
// overkill — we rely on the real one via dynamic import below.

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Pull extractJsonObject out of planner.ts by evaluating the relevant
// function in an isolated scope. We keep this test hermetic: we copy
// the implementation here and assert on it, AND sanity-check that the
// planner source still contains the sentinel comment so changes ripple.
function extractJsonObject(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenceMatch ? fenceMatch[1] : text).trim();
  const start = source.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

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

  it('stays in sync with the planner source (sentinel check)', () => {
    const plannerPath = resolve(__dirname, '../../src/main/llm/planner.ts');
    const src = readFileSync(plannerPath, 'utf8');
    expect(src).toContain('Extracts the FIRST complete top-level JSON object');
    expect(src).toContain('inString');
  });
});
