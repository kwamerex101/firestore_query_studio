import type { DatabaseDriver, SqlDriver, TestConnectionOutcome } from '../drivers/types';
import { createDriver } from '../drivers';
import { FirestoreDriver } from '../drivers/firestore';
import { isSqlDriver } from '../drivers/types';
import type { FirestoreHandle } from './types';
import { getActiveProfileId, getProfile } from '../profiles/profileStore';

let current: DatabaseDriver | null = null;
let currentProfileId: string | null = null;

export async function disposeCurrent(): Promise<void> {
  if (current) {
    const handle = current;
    current = null;
    currentProfileId = null;
    await handle.dispose();
  }
}

export async function getDriverForActive(): Promise<DatabaseDriver> {
  const activeId = await getActiveProfileId();
  if (!activeId) throw new Error('No active profile is selected.');
  if (current && currentProfileId === activeId) return current;
  await disposeCurrent();
  const profile = await getProfile(activeId);
  if (!profile) throw new Error(`Active profile not found: ${activeId}`);
  current = await createDriver(profile);
  currentProfileId = activeId;
  return current;
}

/**
 * Back-compat helper: many existing modules (schemaSampler, executor,
 * insights) need the raw Admin SDK `Firestore`. Calling this on a Postgres
 * profile throws with a clear message the renderer can show.
 */
export async function getHandleForActive(): Promise<FirestoreHandle> {
  const driver = await getDriverForActive();
  if (!(driver instanceof FirestoreDriver)) {
    throw new Error(
      `This action requires a Firestore profile. Active profile uses engine: ${driver.engine}.`,
    );
  }
  return driver.handle;
}

/**
 * Get the active driver narrowed to a relational engine. Throws a clear
 * error when the active profile is Firestore, so the caller (IPC router,
 * SQL planner) doesn't need to care which specific SQL engine it is.
 */
export async function getSqlDriverForActive(): Promise<SqlDriver> {
  const driver = await getDriverForActive();
  if (!isSqlDriver(driver)) {
    throw new Error(
      `This action requires a SQL profile (Postgres, MySQL, MSSQL). Active profile uses engine: ${driver.engine}.`,
    );
  }
  return driver;
}

/** Test a specific profile without making it active or swapping `current`. */
export async function testConnectionForProfile(profileId: string): Promise<TestConnectionOutcome> {
  const profile = await getProfile(profileId);
  if (!profile) {
    return {
      ok: false,
      code: 'PROFILE_NOT_FOUND',
      message: `Profile not found: ${profileId}`,
      elapsedMs: 0,
    };
  }
  const driver = await createDriver(profile);
  try {
    return await driver.testConnection();
  } finally {
    // For relational drivers we always dispose because this was a
    // throwaway pool. For Firestore we only dispose when this driver is
    // NOT the cached active one, to avoid tearing down an in-use Admin
    // SDK app.
    if (isSqlDriver(driver) || driver !== current) {
      await driver.dispose();
    }
  }
}

export async function onProfileChanged(): Promise<void> {
  // Called after profiles.setActive or when the active profile is edited.
  await disposeCurrent();
}
