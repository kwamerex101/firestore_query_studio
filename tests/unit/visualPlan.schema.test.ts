import { describe, expect, it } from 'vitest';
import {
  VisualPlan,
  VisualSpec,
  parseVisualPlanLenient,
} from '@shared/types/visualPlan';

describe('VisualSpec', () => {
  it('accepts a well-formed bar spec', () => {
    const res = VisualSpec.safeParse({
      type: 'bar',
      title: 'Orders by status',
      xField: 'status',
      yField: 'count',
      data: [
        { status: 'new', count: 3 },
        { status: 'paid', count: 5 },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('accepts a kpi spec with numeric value + format', () => {
    const res = VisualSpec.safeParse({
      type: 'kpi',
      title: 'Total orders',
      value: 42,
      format: 'number',
    });
    expect(res.success).toBe(true);
  });

  it('accepts a histogram spec', () => {
    const res = VisualSpec.safeParse({
      type: 'histogram',
      title: 'Latency buckets',
      field: 'latency_ms',
      bins: [
        { label: '<100', count: 10 },
        { label: '100-500', count: 5 },
      ],
    });
    expect(res.success).toBe(true);
  });

  it('rejects a bar spec with empty data', () => {
    const res = VisualSpec.safeParse({
      type: 'bar',
      title: 'Empty',
      xField: 'x',
      yField: 'y',
      data: [],
    });
    expect(res.success).toBe(false);
  });

  it('rejects an unknown chart type', () => {
    const res = VisualSpec.safeParse({
      type: 'radar',
      title: 'Radar',
    });
    expect(res.success).toBe(false);
  });

  it('rejects a pie spec with missing valueField', () => {
    const res = VisualSpec.safeParse({
      type: 'pie',
      title: 'Breakdown',
      labelField: 'status',
      data: [{ status: 'new', value: 1 }],
    });
    expect(res.success).toBe(false);
  });
});

describe('VisualPlan', () => {
  it('defaults specs to an empty array', () => {
    const res = VisualPlan.safeParse({});
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.specs).toEqual([]);
  });

  it('accepts narrative + multiple specs', () => {
    const res = VisualPlan.safeParse({
      narrative: 'Most orders are paid.',
      specs: [
        {
          type: 'kpi',
          title: 'Total',
          value: 100,
        },
        {
          type: 'bar',
          title: 'By status',
          xField: 'status',
          yField: 'count',
          data: [{ status: 'paid', count: 80 }],
        },
      ],
    });
    expect(res.success).toBe(true);
  });
});

describe('parseVisualPlanLenient', () => {
  it('drops malformed specs but keeps valid ones', () => {
    const { plan, dropped } = parseVisualPlanLenient({
      narrative: 'Only the kpi is valid.',
      specs: [
        { type: 'kpi', title: 'Ok', value: 1 },
        { type: 'radar', title: 'Bad' },
        {
          type: 'bar',
          title: 'Also bad',
          xField: 'x',
          yField: 'y',
          data: [],
        },
      ],
    });
    expect(dropped).toBe(2);
    expect(plan.specs).toHaveLength(1);
    expect(plan.specs[0]?.type).toBe('kpi');
    expect(plan.narrative).toBe('Only the kpi is valid.');
  });

  it('handles non-object input without throwing', () => {
    const { plan, dropped } = parseVisualPlanLenient('nope');
    expect(plan.specs).toEqual([]);
    expect(dropped).toBe(0);
    expect(plan.narrative).toBeUndefined();
  });

  it('ignores empty narrative strings', () => {
    const { plan } = parseVisualPlanLenient({ narrative: '   ', specs: [] });
    expect(plan.narrative).toBeUndefined();
  });
});
