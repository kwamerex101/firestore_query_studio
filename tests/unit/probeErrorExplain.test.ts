import { describe, expect, it } from 'vitest';
import { explainSqlProbeError } from '../../src/renderer/lib/probeErrorExplain';

describe('explainSqlProbeError', () => {
  it('explains PostgreSQL pg_hba / 28000 and SSL hint when message says no encryption', () => {
    const ex = explainSqlProbeError(
      '28000',
      'no pg_hba.conf entry for host "41.218.215.3", user "reader", database "postgres", no encryption',
    );
    expect(ex.title).toBe('Server blocked this list request');
    expect(ex.body).toContain('pg_hba.conf');
    expect(ex.body).toContain('normal query');
    expect(ex.showTechnical).toBe(true);
    expect(ex.technical).toContain('pg_hba.conf');
    expect(ex.hint.toLowerCase()).toMatch(/ssl|verify-full|require/);
  });

  it('matches pg_hba errors when code is driver-generic but message mentions pg_hba', () => {
    const ex = explainSqlProbeError(
      'POSTGRES_PROBE_FAILED',
      'FATAL: no pg_hba.conf entry for host "10.0.0.1"',
    );
    expect(ex.title).toBe('Server blocked this list request');
  });

  it('handles missing inputs without technical fold-out', () => {
    const ex = explainSqlProbeError('MISSING_INPUTS', 'Fill in host');
    expect(ex.showTechnical).toBe(false);
    expect(ex.title).toBe('Not enough to connect');
  });
});
