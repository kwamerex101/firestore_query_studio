import { describe, expect, it } from 'vitest';
import { buildSqlPlan } from '@shared/planner';
import type { ChatBackend } from '@shared/planner';

function mockChat(content: string): ChatBackend {
  return async () => ({ content, model: 'mock' });
}

const BASE = {
  question: 'List recent orders',
  dialect: 'postgres' as const,
  defaultLimit: 100,
};

describe('buildSqlPlan', () => {
  it('accepts a clean JSON plan and normalises the SQL', async () => {
    const res = await buildSqlPlan(
      {
        chat: mockChat(
          JSON.stringify({
            mode: 'sql',
            dialect: 'postgres',
            sql: 'SELECT id, total FROM orders ORDER BY created_at DESC LIMIT 10;',
            rationale: 'Return the 10 latest orders.',
            limit: 10,
            tables: ['orders'],
          }),
        ),
      },
      BASE,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.sql.endsWith(';')).toBe(false);
      expect(res.plan.tables).toEqual(['orders']);
    }
  });

  it('strips markdown fences around the JSON', async () => {
    const response = [
      '```json',
      JSON.stringify({
        mode: 'sql',
        dialect: 'postgres',
        sql: 'SELECT 1',
        rationale: 'trivial',
        limit: 1,
        tables: [],
      }),
      '```',
    ].join('\n');
    const res = await buildSqlPlan({ chat: mockChat(response) }, BASE);
    expect(res.ok).toBe(true);
  });

  it('fails when no JSON object is present', async () => {
    const res = await buildSqlPlan({ chat: mockChat('sorry, I cannot') }, BASE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NO_JSON');
  });

  it('fails when JSON is malformed', async () => {
    const res = await buildSqlPlan({ chat: mockChat('{ not: json')}, BASE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(['NO_JSON', 'INVALID_JSON']).toContain(res.code);
  });

  it('fails on schema violations', async () => {
    const res = await buildSqlPlan(
      {
        chat: mockChat(
          JSON.stringify({
            mode: 'select',
            dialect: 'postgres',
            // sql missing
            rationale: 'oops',
            limit: 10,
            tables: ['orders'],
          }),
        ),
      },
      BASE,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('SCHEMA_VIOLATION');
  });

  it('rejects a plan whose SQL is unsafe', async () => {
    const res = await buildSqlPlan(
      {
        chat: mockChat(
          JSON.stringify({
            mode: 'sql',
            dialect: 'postgres',
            sql: 'DELETE FROM orders',
            rationale: 'danger',
            limit: 10,
            tables: ['orders'],
          }),
        ),
      },
      BASE,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code.startsWith('UNSAFE_SQL')).toBe(true);
  });

  it('rejects a plan whose dialect differs from the profile', async () => {
    const res = await buildSqlPlan(
      {
        chat: mockChat(
          JSON.stringify({
            mode: 'sql',
            dialect: 'mysql',
            sql: 'SELECT 1',
            rationale: 'wrong dialect',
            limit: 1,
            tables: [],
          }),
        ),
      },
      BASE,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('DIALECT_MISMATCH');
  });
});
