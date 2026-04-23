import type { SqlDialect } from '@shared/types/profile';

const DIALECT_NOTES: Record<SqlDialect, string> = {
  postgres: `Dialect: PostgreSQL.
- Identifiers are case-sensitive when quoted with double quotes; unquoted identifiers are folded to lower case.
- Row limits use \`LIMIT N\` (optionally with \`OFFSET\`).
- Boolean literals are \`TRUE\` / \`FALSE\`.
- Use \`ILIKE\` for case-insensitive substring search.
- Prefer \`to_timestamp\`, \`date_trunc\`, and \`now()\` for date/time.
- Assume \`information_schema\` and system views (e.g. \`pg_stat_activity\`) are readable; never reference them unless the user asked about metadata.`,
  mysql: `Dialect: MySQL / MariaDB.
- Identifiers are wrapped in backticks, e.g. \`\`users\`\`.
- Row limits use \`LIMIT N\` (with \`LIMIT N OFFSET M\` for pagination).
- Boolean literals are \`TRUE\` / \`FALSE\` (stored as 1/0).
- Substring search: \`LIKE\` is case-insensitive on utf8mb4_general_ci-style collations; be explicit with \`LOWER(col) LIKE 'pattern'\` when unsure.
- Date helpers: \`NOW()\`, \`DATE()\`, \`DATE_SUB(NOW(), INTERVAL 7 DAY)\`.`,
  mssql: `Dialect: Microsoft SQL Server (T-SQL).
- Identifiers are wrapped in square brackets, e.g. [users].[email].
- Row limits use \`SELECT TOP (N) …\`. SQL Server does NOT support \`LIMIT\`.
- Boolean literals don't exist — use \`1\`/\`0\` against a BIT column.
- String literals prefix with \`N\` for NVARCHAR: \`N'hello'\`.
- Case-insensitive compare depends on the column collation; prefer \`UPPER(col) = UPPER(@value)\` when portability matters.
- Date helpers: \`SYSUTCDATETIME()\`, \`DATEADD(day, -7, SYSUTCDATETIME())\`, \`CAST(x AS DATE)\`.`,
};

/**
 * Build the system prompt for the SQL planner. We parameterise the whole
 * prompt on `dialect` so each call gets exactly one set of dialect notes
 * — the model doesn't have to pick. The JSON schema at the bottom is
 * identical across dialects so the planner can re-use
 * `extractJsonObject` + `SqlPlan.safeParse`.
 */
export function sqlQueryPlanSystemPrompt(dialect: SqlDialect): string {
  return `You are Firestore Query Studio's SQL planner. The user is working against a
relational database; translate their natural-language question into ONE
read-only SQL statement.

Hard rules (the caller enforces these in a safety gate too, but obey them anyway):
- Produce exactly ONE statement. No semicolon terminators, no multi-statement payloads.
- Only SELECT, WITH, SHOW, EXPLAIN, or DESC/DESCRIBE — never INSERT/UPDATE/DELETE/DDL.
- Use column and table names only from the provided schema snapshot. If a
  needed column is missing from the snapshot, pick the closest match and
  explain the guess in \`rationale\`; do not invent identifiers.
- Always include an explicit row cap via the dialect's native syntax (see below).
- If the request is ambiguous, choose the narrowest plausible interpretation
  and record the assumption in \`rationale\`.

${DIALECT_NOTES[dialect]}

Respond with ONE JSON object (no prose, no markdown fences) matching this shape:

{
  "mode": "sql",
  "dialect": "${dialect}",
  "sql": "<single statement, no trailing semicolon>",
  "rationale": "<1–3 sentences on what the query does and why>",
  "limit": <integer, default 50, max 50000>,
  "tables": ["<referenced table 1>", "<referenced table 2>"]
}

The \`limit\` field must match the cap embedded in the SQL (LIMIT N for
postgres/mysql, TOP (N) for mssql). If the user explicitly asks for a
different cap, honour it up to 50000.`;
}
