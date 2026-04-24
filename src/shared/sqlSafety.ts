/**
 * Read-only SQL safety gate. Every relational driver (Postgres, MySQL,
 * MSSQL) routes user-generated SQL through these helpers before hitting
 * the wire. The intent is belt-and-braces defence against the planner
 * emitting anything other than a single SELECT-shaped statement:
 *
 *   1. `validateReadOnlySql` rejects DDL/DML and multi-statement payloads.
 *   2. `clampLimit` appends or replaces the trailing row cap using the
 *      correct dialect syntax (LIMIT for PG/MySQL, TOP for MSSQL).
 *
 * Both helpers are pure — they don't hit the database — which makes them
 * cheap to unit-test and safe to run twice (planner + driver) without any
 * side effects.
 */

import type { SqlDialect } from '@shared/types/profile';

const ALLOWED_STATEMENT_LEADS = [
  'SELECT',
  'WITH',
  'SHOW',
  'EXPLAIN',
  'DESC',
  'DESCRIBE',
] as const;

const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'TRUNCATE',
  'ALTER',
  'CREATE',
  'GRANT',
  'REVOKE',
  'MERGE',
  'REPLACE',
  'CALL',
  'EXEC',
  'EXECUTE',
  'ATTACH',
  'DETACH',
] as const;

export interface SqlSafetyOk {
  ok: true;
  /** The original SQL with trailing whitespace + trailing `;` stripped. */
  normalized: string;
}
export interface SqlSafetyErr {
  ok: false;
  code:
    | 'EMPTY_SQL'
    | 'MULTIPLE_STATEMENTS'
    | 'WRITE_STATEMENT'
    | 'FORBIDDEN_KEYWORD';
  message: string;
}
export type SqlSafetyOutcome = SqlSafetyOk | SqlSafetyErr;

/**
 * Strip SQL comments (`-- …` line comments and `/* … *\/` block comments)
 * and collapse whitespace. Used before the keyword scan so comments can't
 * smuggle banned tokens past the checker.
 */
function stripCommentsAndStrings(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    // Line comment: -- … \n
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i += 1;
      continue;
    }
    // Block comment: /* … */ (non-nesting; good enough for planner output)
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    // Single- or double-quoted string literal. Collapse to a placeholder so
    // keywords inside strings don't trip the scan.
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += "''";
      i += 1;
      while (i < n) {
        if (sql[i] === '\\' && sql[i + 1] !== undefined) {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          // Handle SQL-style doubled quotes as escape ("" or '').
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Return true iff `sql` contains more than one meaningful statement. Uses
 * the comment/string-stripped form so `;` inside a literal doesn't count.
 */
function hasMultipleStatements(strippedSql: string): boolean {
  const trimmed = strippedSql.trim().replace(/;+\s*$/, '').trim();
  return trimmed.includes(';');
}

/**
 * Validate that `sql` is a single read-only statement. Returns a structured
 * outcome so callers can log the exact failure rather than a generic error.
 */
export function validateReadOnlySql(sql: string): SqlSafetyOutcome {
  const trimmed = sql.trim().replace(/;+\s*$/, '').trim();
  if (!trimmed) {
    return {
      ok: false,
      code: 'EMPTY_SQL',
      message: 'SQL is empty.',
    };
  }
  const stripped = stripCommentsAndStrings(trimmed);
  if (hasMultipleStatements(stripped)) {
    return {
      ok: false,
      code: 'MULTIPLE_STATEMENTS',
      message:
        'Only a single statement is allowed. Split multi-statement payloads into separate plans.',
    };
  }
  const firstWord = stripped.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? '';
  if (!ALLOWED_STATEMENT_LEADS.includes(firstWord as (typeof ALLOWED_STATEMENT_LEADS)[number])) {
    return {
      ok: false,
      code: 'WRITE_STATEMENT',
      message: `Only read-only statements are allowed (got "${firstWord || '?'}"). Allowed: ${ALLOWED_STATEMENT_LEADS.join(', ')}.`,
    };
  }
  // Word-boundary scan on the stripped form. We match keywords as standalone
  // tokens so column/table names like `updated_at` don't trigger the UPDATE
  // check.
  const upper = ` ${stripped.toUpperCase()} `;
  for (const keyword of FORBIDDEN_KEYWORDS) {
    const pattern = new RegExp(`[^A-Z0-9_]${keyword}[^A-Z0-9_]`);
    if (pattern.test(upper)) {
      return {
        ok: false,
        code: 'FORBIDDEN_KEYWORD',
        message: `SQL contains forbidden keyword "${keyword}". This tool is read-only.`,
      };
    }
  }
  return { ok: true, normalized: trimmed };
}

/**
 * Append or lower an explicit row cap to `sql` so a query never returns
 * more than `limit` rows, regardless of what the planner emitted. Adds
 * the cap conservatively:
 *
 *   - For Postgres / MySQL: append `LIMIT N` when no explicit LIMIT is
 *     present; otherwise clamp the existing value down (never up).
 *   - For MSSQL: SQL Server doesn't support `LIMIT`. If the statement
 *     already has a `TOP (n)` we clamp it; otherwise we wrap the query in
 *     `SELECT TOP (N) * FROM (<sql>) AS _sub`.
 *
 * If `limit` is non-positive or the SQL isn't a simple SELECT we return
 * the input untouched — the executor will enforce its own server-side
 * timeout.
 */
export function clampLimit(
  sql: string,
  limit: number,
  dialect: SqlDialect,
): string {
  if (!Number.isFinite(limit) || limit <= 0) return sql;
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!trimmed) return sql;

  if (dialect === 'postgres' || dialect === 'mysql' || dialect === 'bigquery' || dialect === 'sqlite') {
    const limitRegex = /\blimit\s+(\d+)(?:\s+offset\s+\d+)?\s*$/i;
    const match = trimmed.match(limitRegex);
    if (match) {
      const current = Number(match[1]);
      if (Number.isFinite(current) && current > limit) {
        return trimmed.replace(limitRegex, (full) =>
          full.replace(String(current), String(limit)),
        );
      }
      return trimmed;
    }
    return `${trimmed}\nLIMIT ${limit}`;
  }

  // MSSQL. Look for `SELECT [DISTINCT] TOP (...)` or `SELECT [DISTINCT] TOP N`
  // at the very start of the statement and clamp; otherwise wrap.
  const topParenRegex = /^(\s*SELECT\s+(?:DISTINCT\s+)?)TOP\s*\(\s*(\d+)\s*\)/i;
  const topBareRegex = /^(\s*SELECT\s+(?:DISTINCT\s+)?)TOP\s+(\d+)/i;
  const parenMatch = trimmed.match(topParenRegex);
  if (parenMatch) {
    const current = Number(parenMatch[2]);
    if (Number.isFinite(current) && current > limit) {
      return trimmed.replace(topParenRegex, `$1TOP (${limit})`);
    }
    return trimmed;
  }
  const bareMatch = trimmed.match(topBareRegex);
  if (bareMatch) {
    const current = Number(bareMatch[2]);
    if (Number.isFinite(current) && current > limit) {
      return trimmed.replace(topBareRegex, `$1TOP (${limit})`);
    }
    return trimmed;
  }
  // Wrap only if the statement starts with SELECT — WITH/EXPLAIN/etc. stay
  // as-is.
  if (/^\s*SELECT\b/i.test(trimmed)) {
    return `SELECT TOP (${limit}) * FROM (\n${trimmed}\n) AS _fqs_limit_wrap`;
  }
  return trimmed;
}
