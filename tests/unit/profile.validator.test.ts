import { describe, expect, it } from 'vitest';
import { Profile, ProfileInput, ProfileUpdate } from '@shared/types/profile';

describe('ProfileInput', () => {
  it('accepts an emulator profile', () => {
    const r = ProfileInput.parse({
      name: 'Local',
      kind: 'emulator',
      envTag: 'dev',
      projectId: 'my-proj',
      host: '127.0.0.1',
      port: 8080,
    });
    if ('engine' in r && r.engine !== 'firestore') {
      throw new Error('expected firestore variant');
    }
    expect(r.kind).toBe('emulator');
  });

  it('accepts a live profile', () => {
    const r = ProfileInput.parse({
      name: 'Prod',
      kind: 'live',
      envTag: 'prod',
      projectId: 'my-proj',
      serviceAccountPath: '/tmp/sa.json',
    });
    if ('engine' in r && r.engine !== 'firestore') {
      throw new Error('expected firestore variant');
    }
    expect(r.kind).toBe('live');
  });

  it('rejects missing projectId', () => {
    const r = ProfileInput.safeParse({
      name: 'x',
      kind: 'emulator',
      envTag: 'dev',
    });
    expect(r.success).toBe(false);
  });

  it('accepts a minimal Postgres profile', () => {
    const r = ProfileInput.parse({
      engine: 'postgres',
      name: 'Local PG',
      envTag: 'dev',
      database: 'app',
      user: 'postgres',
      password: 'secret',
    });
    if (!('engine' in r) || r.engine !== 'postgres') {
      throw new Error('expected postgres variant');
    }
    expect(r.database).toBe('app');
    expect(r.user).toBe('postgres');
    expect(r.password).toBe('secret');
  });

  it('accepts a minimal MySQL profile', () => {
    const r = ProfileInput.parse({
      engine: 'mysql',
      name: 'Local MySQL',
      envTag: 'dev',
      database: 'app',
      user: 'root',
      password: 'secret',
    });
    if (!('engine' in r) || r.engine !== 'mysql') {
      throw new Error('expected mysql variant');
    }
    expect(r.database).toBe('app');
    expect(r.user).toBe('root');
    expect(r.password).toBe('secret');
  });

  it('accepts a minimal MSSQL profile', () => {
    const r = ProfileInput.parse({
      engine: 'mssql',
      name: 'Local MSSQL',
      envTag: 'dev',
      database: 'app',
      user: 'sa',
      password: 'secret',
    });
    if (!('engine' in r) || r.engine !== 'mssql') {
      throw new Error('expected mssql variant');
    }
    expect(r.database).toBe('app');
    expect(r.user).toBe('sa');
  });

  it('Profile schema applies mysql defaults (host, port)', () => {
    const r = Profile.parse({
      id: 'p1',
      engine: 'mysql',
      name: 'Local MySQL',
      envTag: 'dev',
      database: 'app',
      user: 'root',
      createdAt: 1,
      updatedAt: 2,
    });
    if (r.engine !== 'mysql') throw new Error('expected mysql');
    expect(r.host).toBe('127.0.0.1');
    expect(r.port).toBe(3306);
    expect(r.hasPassword).toBe(false);
  });

  it('Profile schema applies mssql defaults (host, port, encrypt)', () => {
    const r = Profile.parse({
      id: 'p1',
      engine: 'mssql',
      name: 'Local MSSQL',
      envTag: 'dev',
      database: 'app',
      user: 'sa',
      createdAt: 1,
      updatedAt: 2,
    });
    if (r.engine !== 'mssql') throw new Error('expected mssql');
    expect(r.host).toBe('127.0.0.1');
    expect(r.port).toBe(1433);
    expect(r.encrypt).toBe(true);
    expect(r.trustServerCertificate).toBe(false);
  });

  it('rejects a SQL profile with an unknown engine', () => {
    const r = ProfileInput.safeParse({
      engine: 'oracle',
      name: 'x',
      envTag: 'dev',
      database: 'app',
      user: 'x',
    });
    expect(r.success).toBe(false);
  });
});

describe('Profile migration', () => {
  it('accepts legacy profile JSON without engine field (Firestore default)', () => {
    const legacy = {
      id: 'abc',
      name: 'Legacy',
      kind: 'emulator',
      envTag: 'dev',
      projectId: 'demo',
      host: '127.0.0.1',
      port: 8080,
      scanCap: 500,
      sampleSize: 10,
      createdAt: 1,
      updatedAt: 2,
    };
    const r = Profile.parse(legacy);
    expect(r.engine).toBe('firestore');
  });
});

describe('ProfileUpdate', () => {
  it('accepts partial updates', () => {
    const r = ProfileUpdate.parse({ name: 'renamed' });
    expect(r.name).toBe('renamed');
  });

  it('rejects unknown keys (strict)', () => {
    const r = ProfileUpdate.safeParse({ name: 'x', evil: true });
    expect(r.success).toBe(false);
  });
});
