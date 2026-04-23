import { describe, expect, it } from 'vitest';
import { generateVisuals, type ChatBackend } from '@shared/planner';
import type {
  VisualsGenerateRequest,
  SqlColumn,
} from '@shared/types/ipc';

function mockChat(content: string): ChatBackend {
  return async () => ({ content, model: 'mock-model' });
}

function firestoreReq(
  rows: Array<{ id: string; path: string; data: Record<string, unknown> }>,
): VisualsGenerateRequest {
  return {
    source: 'firestore',
    question: 'How many orders per status?',
    collection: 'orders',
    plan: {
      mode: 'query',
      collection: 'orders',
      rationale: 'Group by status',
    } as never,
    outcome: {
      ok: true,
      rows,
      stats: {
        mode: 'query',
        scanned: rows.length,
        matched: rows.length,
        returned: rows.length,
        durationMs: 12,
        truncated: false,
      },
      warnings: [],
    } as never,
  };
}

function sqlReq(rows: number): VisualsGenerateRequest {
  const data: Array<Record<string, unknown>> = Array.from(
    { length: rows },
    (_, i) => ({ status: i % 2 ? 'paid' : 'new', count: i + 1 }),
  );
  const columns: SqlColumn[] = [
    { name: 'status', dataType: 'text' },
    { name: 'count', dataType: 'int' },
  ];
  return {
    source: 'sql',
    question: 'Count by status',
    sql: 'SELECT status, count(*) FROM orders GROUP BY status',
    columns,
    rows: data,
    truncated: false,
  };
}

describe('generateVisuals', () => {
  it('parses a well-formed JSON plan from the LLM', async () => {
    const body = JSON.stringify({
      narrative: 'Most orders are paid.',
      specs: [
        { type: 'kpi', title: 'Total', value: 10 },
        {
          type: 'bar',
          title: 'By status',
          xField: 'status',
          yField: 'count',
          data: [
            { status: 'paid', count: 7 },
            { status: 'new', count: 3 },
          ],
        },
      ],
    });
    const res = await generateVisuals(
      { chat: mockChat(body) },
      firestoreReq([
        { id: '1', path: 'orders/1', data: { status: 'paid' } },
        { id: '2', path: 'orders/2', data: { status: 'new' } },
      ]),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.specs).toHaveLength(2);
      expect(res.plan.narrative).toBe('Most orders are paid.');
      expect(res.specsDropped).toBe(0);
      expect(res.model).toBe('mock-model');
    }
  });

  it('unwraps ```json fenced responses', async () => {
    const body = [
      '```json',
      JSON.stringify({
        specs: [{ type: 'kpi', title: 'Rows', value: 1 }],
      }),
      '```',
    ].join('\n');
    const res = await generateVisuals(
      { chat: mockChat(body) },
      firestoreReq([{ id: '1', path: 'orders/1', data: { x: 1 } }]),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.plan.specs).toHaveLength(1);
  });

  it('drops malformed specs but keeps the good ones', async () => {
    const body = JSON.stringify({
      specs: [
        { type: 'kpi', title: 'OK', value: 1 },
        { type: 'radar', title: 'bad' },
        {
          type: 'bar',
          title: 'Empty',
          xField: 'x',
          yField: 'y',
          data: [],
        },
      ],
    });
    const res = await generateVisuals(
      { chat: mockChat(body) },
      sqlReq(3),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.specs).toHaveLength(1);
      expect(res.specsDropped).toBe(2);
    }
  });

  it('flags NO_JSON when the LLM returns prose only', async () => {
    const res = await generateVisuals(
      { chat: mockChat('Sorry, I cannot make charts.') },
      sqlReq(1),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NO_JSON');
  });

  it('flags INVALID_JSON when the extracted object is broken', async () => {
    const res = await generateVisuals(
      { chat: mockChat('{ "specs": [ { type: oops ] ') },
      sqlReq(1),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(['NO_JSON', 'INVALID_JSON']).toContain(res.code);
    }
  });

  it('marks rowSampleTruncated when the sample is clipped', async () => {
    const manyRows = Array.from({ length: 60 }, (_, i) => ({
      id: String(i),
      path: `orders/${i}`,
      data: { status: i % 2 ? 'paid' : 'new' },
    }));
    const res = await generateVisuals(
      { chat: mockChat('{"specs":[]}') },
      firestoreReq(manyRows),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rowSampleTruncated).toBe(true);
    }
  });
});
