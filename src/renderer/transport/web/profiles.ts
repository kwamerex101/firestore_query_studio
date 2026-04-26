import {
  LiveProfile,
  Profile,
  ProfileInput,
  ProfileUpdate,
} from '@shared/types/profile';
import type {
  ActiveProfileResult,
  SetActiveProfileRequest,
} from '@shared/types/ipc';
import type { FirebaseWebConfig } from '../types';
import { getDb, SettingsKeys } from './db';

export type { FirebaseWebConfig } from '../types';

/**
 * On web we reuse the Electron `LiveProfile` shape to keep the UI identical.
 * The `serviceAccountPath` field is repurposed as an opaque marker
 * `byoc://<profileId>` ("bring your own config"): the actual Firebase Web
 * config is stored in a side table and loaded by id when the executor
 * initializes Firebase. This keeps `Profile` Zod validation unchanged
 * across shells while letting us store the extra web-only fields.
 */
const WEB_PROFILE_MARKER_PREFIX = 'byoc://';

function makeWebMarker(id: string): string {
  return `${WEB_PROFILE_MARKER_PREFIX}${id}`;
}

export function isWebProfileMarker(s: string): boolean {
  return s.startsWith(WEB_PROFILE_MARKER_PREFIX);
}

function newId(): string {
  // `crypto.randomUUID` is widely supported, including every browser that
  // can run a PWA, so skip the polyfill.
  return crypto.randomUUID();
}

async function loadProfileRecord(
  id: string,
): Promise<{ profile: Profile; firebaseConfig?: FirebaseWebConfig } | null> {
  const db = await getDb();
  const row = await db.get('profiles', id);
  if (!row) return null;
  const profile = Profile.parse(row.profile);
  return {
    profile,
    firebaseConfig: row.firebaseConfig as FirebaseWebConfig | undefined,
  };
}

export async function listProfiles(): Promise<Profile[]> {
  const db = await getDb();
  const all = await db.getAll('profiles');
  return all.map((row) => Profile.parse(row.profile));
}

export async function createProfile(input: ProfileInput): Promise<Profile> {
  const parsed = ProfileInput.parse(input);

  // The web build deliberately does NOT support any relational engine (no
  // TCP from the browser) nor the Electron emulator flow (which assumes a
  // local host port). Reject loudly so the caller sees the feature flag.
  if ('engine' in parsed && parsed.engine === 'postgres') {
    throw new Error(
      'Postgres profiles are not available in the web build. Use the desktop app for Postgres access.',
    );
  }
  if ('engine' in parsed && parsed.engine === 'mysql') {
    throw new Error(
      'MySQL profiles are not available in the web build. Use the desktop app for MySQL access.',
    );
  }
  if ('engine' in parsed && parsed.engine === 'mssql') {
    throw new Error(
      'SQL Server profiles are not available in the web build. Use the desktop app for MSSQL access.',
    );
  }
  if ('engine' in parsed && parsed.engine === 'bigquery') {
    throw new Error(
      'BigQuery profiles are not available in the web build. Use the desktop app — BigQuery auth requires a service-account JSON only the main process can read.',
    );
  }
  if ('engine' in parsed && parsed.engine === 'file') {
    throw new Error(
      'File-backed profiles require native SQLite and filesystem access, so they are only available in the desktop app.',
    );
  }
  if ('engine' in parsed && parsed.engine === 'rtdb') {
    throw new Error(
      'Realtime Database (Admin SDK) profiles are not available in the web build. Use the desktop app for RTDB access.',
    );
  }
  if (!('kind' in parsed) || parsed.kind === 'emulator') {
    throw new Error(
      'The Firestore emulator flow requires the desktop app. In the web build, create a "live" profile and supply your Firebase Web config.',
    );
  }

  const now = Date.now();
  const id = newId();
  const pl = parsed as { name: string; envTag: (typeof parsed)['envTag']; projectId: string; scanCap?: number; sampleSize?: number };
  const profile = LiveProfile.parse({
    id,
    name: pl.name,
    engine: 'firestore',
    kind: 'live',
    envTag: pl.envTag,
    projectId: pl.projectId,
    // `serviceAccountPath` is an opaque marker on web — see the module
    // docstring. Real Firebase Web config goes into `firebaseConfig` below
    // once the user supplies it (via the `web-auth` sign-in flow).
    serviceAccountPath: makeWebMarker(id),
    scanCap: pl.scanCap ?? 500,
    sampleSize: pl.sampleSize ?? 10,
    createdAt: now,
    updatedAt: now,
  });

  const db = await getDb();
  await db.put('profiles', {
    id,
    profile,
    firebaseConfig: undefined,
    updatedAt: now,
  });
  return profile;
}

export async function updateProfile(
  id: string,
  update: ProfileUpdate,
): Promise<Profile> {
  const parsed = ProfileUpdate.parse(update);
  const record = await loadProfileRecord(id);
  if (!record) throw new Error(`Profile not found: ${id}`);
  if (record.profile.engine !== 'firestore' || record.profile.kind !== 'live') {
    throw new Error(
      `Web transport only supports Firestore 'live' profiles; got ${record.profile.engine}/${(record.profile as { kind?: string }).kind ?? '??'}.`,
    );
  }
  const current = record.profile;
  const now = Date.now();
  const next = LiveProfile.parse({
    ...current,
    name: parsed.name ?? current.name,
    envTag: parsed.envTag ?? current.envTag,
    projectId: parsed.projectId ?? current.projectId,
    scanCap: parsed.scanCap ?? current.scanCap,
    sampleSize: parsed.sampleSize ?? current.sampleSize,
    // Always preserve the BYOC marker — the user can't paste a filesystem
    // path into a browser profile.
    serviceAccountPath: makeWebMarker(id),
    updatedAt: now,
  });

  const db = await getDb();
  await db.put('profiles', {
    id,
    profile: next,
    firebaseConfig: record.firebaseConfig,
    updatedAt: now,
  });
  return next;
}

export async function deleteProfile(id: string): Promise<void> {
  const db = await getDb();
  const existing = await db.get('profiles', id);
  if (!existing) throw new Error(`Profile not found: ${id}`);
  await db.delete('profiles', id);
  const active = await getActiveProfileId();
  if (active === id) await setActiveProfileId({ profileId: null });
}

export async function getProfile(id: string): Promise<Profile | null> {
  const r = await loadProfileRecord(id);
  return r?.profile ?? null;
}

export async function getFirebaseConfigFor(
  id: string,
): Promise<FirebaseWebConfig | null> {
  const r = await loadProfileRecord(id);
  return r?.firebaseConfig ?? null;
}

export async function setFirebaseConfigFor(
  id: string,
  config: FirebaseWebConfig | null,
): Promise<void> {
  const db = await getDb();
  const existing = await db.get('profiles', id);
  if (!existing) throw new Error(`Profile not found: ${id}`);
  await db.put('profiles', {
    ...existing,
    firebaseConfig: config ?? undefined,
    updatedAt: Date.now(),
  });
}

export async function getActiveProfileId(): Promise<string | null> {
  const db = await getDb();
  const v = (await db.get('settings', SettingsKeys.activeProfileId)) as
    | string
    | null
    | undefined;
  return v ?? null;
}

export async function setActiveProfileId(
  req: SetActiveProfileRequest,
): Promise<ActiveProfileResult> {
  const db = await getDb();
  if (req.profileId !== null) {
    const exists = await db.get('profiles', req.profileId);
    if (!exists) throw new Error(`Profile not found: ${req.profileId}`);
  }
  await db.put(
    'settings',
    req.profileId as unknown as never,
    SettingsKeys.activeProfileId,
  );
  return { profileId: req.profileId };
}

export async function getActiveProfileResult(): Promise<ActiveProfileResult> {
  return { profileId: await getActiveProfileId() };
}
