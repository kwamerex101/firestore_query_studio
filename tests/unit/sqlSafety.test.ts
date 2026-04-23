import { describe, expect, it } from 'vitest';
import { clampLimit, validateReadOnlySql } from '@shared/sqlSafety';

describe('validateReadOnlySql', () => {
  it('accepts a simple SELECT', () => {
    const r = validateReadOnlySql('SELECT 1');
    expect(r.ok).toBe(true);
  });

  it('accepts a WITH/CTE', () => {
    const r = validateReadOnlySql(
      'WITH recent AS (SELECT * FROM orders LIMIT 10) SELECT * FROM recent',
    );
    expect(r.ok).toBe(true);
  });

  it('accepts SHOW / EXPLAIN / DESCRIBE', () => {
    expect(validateReadOnlySql('SHOW TABLES').ok).toBe(true);
    expect(validateReadOnlySql('EXPLAIN SELECT 1').ok).toBe(true);
    expect(validateReadOnlySql('DESCRIBE orders').ok).toBe(true);
    expect(validateReadOnlySql('DESC orders').ok).toBe(true);
  });

  it('strips a trailing semicolon', () => {
    const r = validateReadOnlySql('SELECT 1;');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.endsWith(';')).toBe(false);
  });

  it('rejects empty SQL', () => {
    const r = validateReadOnlySql('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('EMPTY_SQL');
  });

  it('rejects INSERT/UPDATE/DELETE/DROP', () => {
    for (const sql of [
      'INSERT INTO orders VALUES (1)',
      'UPDATE orders SET name=1',
      'DELETE FROM orders',
      'DROP TABLE orders',
      'TRUNCATE orders',
      'ALTER TABLE orders ADD COLUMN x int',
      'CREATE TABLE t (x int)',
    ]) {
      const r = validateReadOnlySql(sql);
      expect(r.ok, `expected ${sql} to fail`).toBe(false);
    }
  });

  it('rejects multi-statement payloads', () => {
    const r = validateReadOnlySql('SELECT 1; SELECT 2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('MULTIPLE_STATEMENTS');
  });

  it("ignores semicolons inside string literals", () => {
    const r = validateReadOnlySql("SELECT ';' AS c");
    expect(r.ok).toBe(true);
  });

  it('does not flag keywords that only appear as column names', () => {
    const r = validateReadOnlySql('SELECT updated_at, created_at FROM orders');
    expect(r.ok).toBe(true);
  });

  it('rejects CALL / EXEC', () => {
    expect(validateReadOnlySql('CALL do_thing()').ok).toBe(false);
    expect(validateReadOnlySql('EXEC sp_whatever').ok).toBe(false);
  });

  it('rejects forbidden keyword hidden after a comment', () => {
    const r = validateReadOnlySql('SELECT 1 /* then */ ; DROP TABLE orders');
    expect(r.ok).toBe(false);
  });
});

describe('clampLimit (postgres/mysql)', () => {
  it('appends LIMIT when none present', () => {
    expect(clampLimit('SELECT * FROM t', 50, 'postgres')).toContain('LIMIT 50');
    expect(clampLimit('SELECT * FROM t', 50, 'mysql')).toContain('LIMIT 50');
  });

  it('lowers an over-sized LIMIT', () => {
    const out = clampLimit('SELECT * FROM t LIMIT 1000', 25, 'postgres');
    expect(out).toMatch(/LIMIT\s+25/);
    expect(out).not.toMatch(/LIMIT\s+1000/);
  });

  it('leaves a smaller LIMIT alone', () => {
    const out = clampLimit('SELECT * FROM t LIMIT 5', 100, 'postgres');
    expect(out).toMatch(/LIMIT\s+5/);
  });

  it('strips trailing semicolons before appending', () => {
    const out = clampLimit('SELECT * FROM t;', 10, 'mysql');
    expect(out.trim().endsWith('LIMIT 10')).toBe(true);
  });
});

describe('clampLimit (mssql)', () => {
  it('wraps a plain SELECT with TOP', () => {
    const out = clampLimit('SELECT * FROM t', 50, 'mssql');
    expect(out).toMatch(/SELECT TOP \(50\)/);
  });

  it('clamps an existing TOP (n)', () => {
    const out = clampLimit('SELECT TOP (1000) * FROM t', 25, 'mssql');
    expect(out).toMatch(/TOP \(25\)/);
    expect(out).not.toMatch(/TOP \(1000\)/);
  });

  it('clamps an existing bare TOP N', () => {
    const out = clampLimit('SELECT TOP 1000 * FROM t', 25, 'mssql');
    expect(out).toMatch(/TOP \(25\)/);
  });

  it('keeps a smaller existing TOP', () => {
    const out = clampLimit('SELECT TOP (5) * FROM t', 100, 'mssql');
    expect(out).toMatch(/TOP \(5\)/);
  });

  it('returns non-SELECT queries untouched', () => {
    expect(clampLimit('EXPLAIN SELECT * FROM t', 50, 'mssql')).toBe(
      'EXPLAIN SELECT * FROM t',
    );
  });
});

describe('clampLimit — degenerate inputs', () => {
  it('returns original sql when limit is non-positive', () => {
    expect(clampLimit('SELECT 1', 0, 'postgres')).toBe('SELECT 1');
    expect(clampLimit('SELECT 1', -5, 'mysql')).toBe('SELECT 1');
    expect(clampLimit('SELECT 1', Number.NaN, 'mssql')).toBe('SELECT 1');
  });
});
