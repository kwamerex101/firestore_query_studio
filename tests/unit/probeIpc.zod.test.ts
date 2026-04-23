import { describe, expect, it } from 'vitest';
import {
  DbProbeSqlDatabasesRequest,
  DbProbeSqlDatabasesOutcome,
  DbProbeSqlSchemasRequest,
  DbProbeSqlSchemasOutcome,
  SqlProbeDraft,
} from '@shared/types/ipc';

describe('SqlProbeDraft', () => {
  it('accepts a minimal Postgres draft and applies sslMode default', () => {
    const parsed = SqlProbeDraft.parse({
      engine: 'postgres',
      host: '127.0.0.1',
      port: 5432,
      user: 'pg',
    });
    expect(parsed.sslMode).toBe('disable');
    expect(parsed.password).toBeUndefined();
  });

  it('carries MSSQL-only extras when provided', () => {
    const parsed = SqlProbeDraft.parse({
      engine: 'mssql',
      host: 'sql.example.com',
      port: 1433,
      user: 'sa',
      password: 'hunter2',
      sslMode: 'require',
      encrypt: true,
      trustServerCertificate: false,
      instanceName: 'SQLEXPRESS',
    });
    expect(parsed.encrypt).toBe(true);
    expect(parsed.trustServerCertificate).toBe(false);
    expect(parsed.instanceName).toBe('SQLEXPRESS');
  });

  it('rejects an unknown engine', () => {
    const r = SqlProbeDraft.safeParse({
      engine: 'oracle',
      host: 'h',
      port: 1521,
      user: 'u',
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-positive ports', () => {
    const r = SqlProbeDraft.safeParse({
      engine: 'postgres',
      host: 'h',
      port: 0,
      user: 'u',
    });
    expect(r.success).toBe(false);
  });
});

describe('DbProbeSqlDatabasesRequest', () => {
  it('accepts a draft-only request (new profile flow)', () => {
    const r = DbProbeSqlDatabasesRequest.parse({
      draft: {
        engine: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'p',
      },
    });
    expect(r.draft?.engine).toBe('mysql');
    expect(r.profileId).toBeUndefined();
  });

  it('accepts a profileId-only request (edit flow, keychain password)', () => {
    const r = DbProbeSqlDatabasesRequest.parse({ profileId: 'prof_123' });
    expect(r.profileId).toBe('prof_123');
    expect(r.draft).toBeUndefined();
  });

  it('accepts both profileId and draft (edit with overrides)', () => {
    const r = DbProbeSqlDatabasesRequest.parse({
      profileId: 'prof_123',
      draft: {
        engine: 'postgres',
        host: 'h',
        port: 5432,
        user: 'u',
      },
    });
    expect(r.profileId).toBe('prof_123');
    expect(r.draft?.engine).toBe('postgres');
  });
});

describe('DbProbeSqlDatabasesOutcome', () => {
  it('parses the ok variant', () => {
    const r = DbProbeSqlDatabasesOutcome.parse({
      ok: true,
      databases: ['a', 'b'],
      elapsedMs: 42,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.databases).toEqual(['a', 'b']);
  });

  it('parses the err variant', () => {
    const r = DbProbeSqlDatabasesOutcome.parse({
      ok: false,
      code: '28P01',
      message: 'bad password',
      elapsedMs: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('28P01');
  });
});

describe('DbProbeSqlSchemasRequest / Outcome', () => {
  it('requires a `database`', () => {
    const bad = DbProbeSqlSchemasRequest.safeParse({
      draft: {
        engine: 'postgres',
        host: 'h',
        port: 5432,
        user: 'u',
        password: 'p',
      },
    });
    expect(bad.success).toBe(false);

    const good = DbProbeSqlSchemasRequest.parse({
      profileId: 'prof_1',
      database: 'app_prod',
    });
    expect(good.database).toBe('app_prod');
  });

  it('parses ok/err outcomes', () => {
    expect(
      DbProbeSqlSchemasOutcome.parse({
        ok: true,
        schemas: ['public'],
        elapsedMs: 0,
      }).ok,
    ).toBe(true);
    expect(
      DbProbeSqlSchemasOutcome.parse({
        ok: false,
        code: 'POSTGRES_PROBE_FAILED',
        message: 'nope',
        elapsedMs: 1,
      }).ok,
    ).toBe(false);
  });
});
