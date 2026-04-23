/**
 * Extracts the FIRST complete top-level JSON object from `text`. Handles:
 * - Plain `{...}` with no wrapping.
 * - Fenced ```json ... ``` blocks (we parse the fence contents the same way).
 * - Prose before the object ("Here is the plan: {...}").
 * - Trailing content after the object (second JSON blob, commentary,
 *   reasoning-channel wrappers).
 *
 * Walks the brace stack, respecting string literals and escape sequences,
 * so braces inside strings don't confuse the counter.
 *
 * Pure string manipulation — safe to import from any target (Node, browser,
 * Electron renderer) and hence lives in `@shared`.
 */
export function extractJsonObject(text: string): string | null {
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
