import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RtdbEmulatorProfile } from '@shared/types/profile';
import { RtdbDriver } from '@main/drivers/rtdb';

/**
 * `pnpm test:emulator-rtdb` wraps with `firebase emulators:exec --only database`
 * and sets `FIREBASE_DATABASE_EMULATOR_HOST`.
 */
describe('RtdbDriver + database emulator', () => {
  let driver: RtdbDriver;

  const profile = RtdbEmulatorProfile.parse({
    id: 'p-rtdb-emu',
    name: 'Emu',
    engine: 'rtdb',
    kind: 'emulator',
    envTag: 'dev',
    projectId: 'fqs-rtdb-int',
    host: '127.0.0.1',
    port: 9000,
    databaseUrl: 'https://fqs-rtdb-default-rtdb.firebaseio.com',
    maxMemoryMb: 512,
    createdAt: 0,
    updatedAt: 0,
  });

  beforeAll(async () => {
    if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
      throw new Error(
        'FIREBASE_DATABASE_EMULATOR_HOST is not set. Run: pnpm test:emulator-rtdb',
      );
    }
    driver = await RtdbDriver.connect(profile);
    await driver.database.ref('items').set({ alpha: 1, beta: 2 });
  });

  afterAll(async () => {
    if (driver) {
      try {
        await driver.database.ref().remove();
      } catch {
        // ignore
      }
      await driver.dispose();
    }
  });

  it('testConnection succeeds', async () => {
    const out = await driver.testConnection();
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('listContainers returns top-level keys from root', async () => {
    const rows = await driver.listContainers();
    const names = rows.map((r) => r.name).sort();
    expect(names).toContain('items');
  });

  it('readPath returns JSON-safe data', async () => {
    const { value } = await driver.readPath('/items/alpha');
    expect(value).toBe(1);
  });

  it('rejects path traversal in readPath', async () => {
    await expect(driver.readPath('/../secret')).rejects.toThrow();
  });
});
