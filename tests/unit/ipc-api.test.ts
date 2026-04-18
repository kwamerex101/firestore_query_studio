import { describe, expect, it } from 'vitest';
import { ipcApi } from '@shared/ipc-api';
import { IpcChannels } from '@shared/types/ipc';

describe('ipcApi', () => {
  it('has a request + response schema for every channel', () => {
    for (const channel of Object.values(IpcChannels)) {
      const entry = (ipcApi as Record<string, unknown>)[channel];
      expect(entry, `missing entry for channel ${channel}`).toBeDefined();
    }
  });

  it('plan.build response validates both ok and error outcomes', () => {
    const schema = ipcApi[IpcChannels.planBuild].response;
    expect(
      schema.safeParse({
        ok: true,
        plan: {
          mode: 'query',
          collection: 'users',
          rationale: 'x',
        },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ ok: false, code: 'LLM_NOT_CONFIGURED', message: 'nope' }).success,
    ).toBe(true);
  });

  it('execute.run request requires a valid plan', () => {
    const schema = ipcApi[IpcChannels.executeRun].request;
    expect(schema.safeParse({ plan: { mode: 'query', collection: '', rationale: 'x' } }).success).toBe(false);
    expect(
      schema.safeParse({ plan: { mode: 'query', collection: 'users', rationale: 'x' } }).success,
    ).toBe(true);
  });
});
