import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the SQL probe helpers. `pg` and `mysql2/promise` are
 * mocked at the module boundary so these tests run without any real
 * database available and without touching the network.
 */

const pgFactoryCalls: Array<{
  opts: { database?: string };
  queries: string[];
}> = [];

class FakeError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

// Configurable per-test behavior. The factory below inspects these
// queues to decide how each new Pool responds.
let nextPgBehaviors: Array<
  | { kind: 'rows'; rows: Array<Record<string, unknown>> }
  | { kind: 'error'; code?: string; message: string }
> = [];

vi.mock('pg', () => {
  return {
    Pool: class {
      private readonly behavior = nextPgBehaviors.shift() ?? {
        kind: 'rows' as const,
        rows: [],
      };
      private readonly record: { opts: { database?: string }; queries: string[] };
      constructor(opts: { database?: string }) {
        this.record = { opts, queries: [] };
        pgFactoryCalls.push(this.record);
      }
      async query(sql: string) {
        this.record.queries.push(sql);
        if (this.behavior.kind === 'error') {
          throw new FakeError(this.behavior.message, this.behavior.code);
        }
        return { rows: this.behavior.rows };
      }
      async end() {
        /* noop */
      }
    },
  };
});

const mysqlFactoryCalls: Array<{ opts: unknown; queries: string[] }> = [];
let nextMysqlBehavior:
  | { kind: 'rows'; rows: Array<Record<string, unknown>> }
  | { kind: 'error'; code?: string; message: string }
  | null = null;

vi.mock('mysql2/promise', () => {
  class FakeMysqlPool {
    private readonly record: { opts: unknown; queries: string[] };
    constructor(opts: unknown) {
      this.record = { opts, queries: [] };
      mysqlFactoryCalls.push(this.record);
    }
    async query(sql: string): Promise<[Array<Record<string, unknown>>, unknown]> {
      this.record.queries.push(sql);
      const behavior = nextMysqlBehavior;
      if (!behavior) return [[], undefined];
      if (behavior.kind === 'error') {
        const err = new FakeError(behavior.message, behavior.code);
        throw err;
      }
      return [behavior.rows, undefined];
    }
    async end() {
      /* noop */
    }
  }
  return {
    default: { createPool: (opts: unknown) => new FakeMysqlPool(opts) },
    createPool: (opts: unknown) => new FakeMysqlPool(opts),
  };
});

afterEach(() => {
  pgFactoryCalls.length = 0;
  mysqlFactoryCalls.length = 0;
  nextPgBehaviors = [];
  nextMysqlBehavior = null;
});

describe('probePostgresDatabases', () => {
  it('returns the list of databases from the `postgres` bootstrap DB', async () => {
    nextPgBehaviors = [
      { kind: 'rows', rows: [{ datname: 'app_prod' }, { datname: 'app_staging' }] },
    ];
    const { probePostgresDatabases } = await import('@main/drivers/postgres');
    const res = await probePostgresDatabases({
      engine: 'postgres',
      host: 'h',
      port: 5432,
      user: 'u',
      password: 'p',
      sslMode: 'disable',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.databases).toEqual(['app_prod', 'app_staging']);
    }
    expect(pgFactoryCalls).toHaveLength(1);
    expect(pgFactoryCalls[0].opts.database).toBe('postgres');
    // Catalog query sanity check.
    expect(pgFactoryCalls[0].queries[0]).toMatch(/pg_database/);
    expect(pgFactoryCalls[0].queries[0]).toMatch(/has_database_privilege/);
  });

  it('falls back to template1 when the `postgres` db does not exist (3D000)', async () => {
    nextPgBehaviors = [
      { kind: 'error', code: '3D000', message: 'database "postgres" does not exist' },
      { kind: 'rows', rows: [{ datname: 'defaultdb' }] },
    ];
    const { probePostgresDatabases } = await import('@main/drivers/postgres');
    const res = await probePostgresDatabases({
      engine: 'postgres',
      host: 'h',
      port: 5432,
      user: 'u',
      password: 'p',
      sslMode: 'require',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.databases).toEqual(['defaultdb']);
    }
    expect(pgFactoryCalls).toHaveLength(2);
    expect(pgFactoryCalls[0].opts.database).toBe('postgres');
    expect(pgFactoryCalls[1].opts.database).toBe('template1');
  });

  it('does NOT fall back on auth/network errors (not 3D000)', async () => {
    nextPgBehaviors = [
      { kind: 'error', code: '28P01', message: 'password authentication failed' },
    ];
    const { probePostgresDatabases } = await import('@main/drivers/postgres');
    const res = await probePostgresDatabases({
      engine: 'postgres',
      host: 'h',
      port: 5432,
      user: 'u',
      password: 'bad',
      sslMode: 'disable',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('28P01');
      expect(res.message).toMatch(/password authentication failed/);
    }
    // Should NOT have tried template1 after an auth failure.
    expect(pgFactoryCalls).toHaveLength(1);
  });
});

describe('probePostgresSchemas', () => {
  it('runs the information_schema.schemata query against the given database', async () => {
    nextPgBehaviors = [
      { kind: 'rows', rows: [{ schema_name: 'public' }, { schema_name: 'analytics' }] },
    ];
    const { probePostgresSchemas } = await import('@main/drivers/postgres');
    const res = await probePostgresSchemas(
      {
        engine: 'postgres',
        host: 'h',
        port: 5432,
        user: 'u',
        password: 'p',
        sslMode: 'disable',
      },
      'app_prod',
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.schemas).toEqual(['public', 'analytics']);
    }
    expect(pgFactoryCalls[0].opts.database).toBe('app_prod');
    expect(pgFactoryCalls[0].queries[0]).toMatch(/information_schema\.schemata/);
  });
});

describe('probeMysqlDatabases', () => {
  it('filters out system schemas via the SQL query', async () => {
    nextMysqlBehavior = {
      kind: 'rows',
      rows: [{ SCHEMA_NAME: 'shop' }, { SCHEMA_NAME: 'analytics' }],
    };
    const { probeMysqlDatabases } = await import('@main/drivers/mysql');
    const res = await probeMysqlDatabases({
      engine: 'mysql',
      host: 'h',
      port: 3306,
      user: 'root',
      password: 'p',
      sslMode: 'disable',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.databases).toEqual(['shop', 'analytics']);
    }
    expect(mysqlFactoryCalls).toHaveLength(1);
    const sql = mysqlFactoryCalls[0].queries[0];
    expect(sql).toMatch(/information_schema\.SCHEMATA/);
    for (const sys of ['information_schema', 'mysql', 'performance_schema', 'sys']) {
      expect(sql).toContain(`'${sys}'`);
    }
  });

  it('propagates driver errors with the MySQL error code', async () => {
    nextMysqlBehavior = {
      kind: 'error',
      code: 'ER_ACCESS_DENIED_ERROR',
      message: "Access denied for user 'root'",
    };
    const { probeMysqlDatabases } = await import('@main/drivers/mysql');
    const res = await probeMysqlDatabases({
      engine: 'mysql',
      host: 'h',
      port: 3306,
      user: 'root',
      password: 'bad',
      sslMode: 'disable',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('ER_ACCESS_DENIED_ERROR');
      expect(res.message).toMatch(/Access denied/);
    }
  });
});
