import { describe, expect, it } from 'vitest';
import { ProfileInput, ProfileUpdate } from '@shared/types/profile';

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
