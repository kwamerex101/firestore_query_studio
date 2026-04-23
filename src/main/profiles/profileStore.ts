import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  Profile,
  ProfileInput,
  ProfileUpdate,
  LiveProfile,
  EmulatorProfile,
  PostgresProfile,
  MysqlProfile,
  MssqlProfile,
} from '@shared/types/profile';
import { clearProfileSecret, setProfileSecret } from './secrets';
import { removeImportedServiceAccount } from '../dialogs/serviceAccount';

const PROFILES_FILENAME = 'profiles.json';
const ACTIVE_FILENAME = 'active-profile.json';

type PersistShape = {
  version: 1;
  profiles: Profile[];
};

type ActiveShape = {
  profileId: string | null;
};

function storeDir(): string {
  return app.getPath('userData');
}
function profilesPath(): string {
  return join(storeDir(), PROFILES_FILENAME);
}
function activePath(): string {
  return join(storeDir(), ACTIVE_FILENAME);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(storeDir(), { recursive: true });
}

async function readFileOr<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await ensureDir();
  await fs.writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}

async function loadProfiles(): Promise<Profile[]> {
  const data = await readFileOr<PersistShape>(profilesPath(), {
    version: 1,
    profiles: [],
  });
  // Profile.parse tolerates the legacy shape (no `engine` field) because the
  // Firestore variants default engine to 'firestore'. New relational profiles
  // are required to carry `engine: 'postgres' | 'mysql' | 'mssql'` explicitly.
  return data.profiles.map((p) => Profile.parse(p));
}

async function saveProfiles(profiles: Profile[]): Promise<void> {
  const data: PersistShape = { version: 1, profiles };
  await writeJson(profilesPath(), data);
}

export async function listProfiles(): Promise<Profile[]> {
  return loadProfiles();
}

export async function getProfile(id: string): Promise<Profile | null> {
  const all = await loadProfiles();
  return all.find((p) => p.id === id) ?? null;
}

export async function createProfile(input: ProfileInput): Promise<Profile> {
  const parsed = ProfileInput.parse(input);
  const now = Date.now();
  const id = randomUUID();

  let profile: Profile;
  let pendingPassword: string | undefined;

  if ('engine' in parsed && parsed.engine === 'postgres') {
    pendingPassword = parsed.password && parsed.password.length > 0 ? parsed.password : undefined;
    profile = PostgresProfile.parse({
      id,
      engine: 'postgres',
      name: parsed.name,
      envTag: parsed.envTag,
      host: parsed.host ?? '127.0.0.1',
      port: parsed.port ?? 5432,
      database: parsed.database,
      user: parsed.user,
      hasPassword: Boolean(pendingPassword),
      sslMode: parsed.sslMode ?? 'disable',
      schema: parsed.schema ?? 'public',
      queryTimeoutMs: parsed.queryTimeoutMs ?? 30_000,
      defaultLimit: parsed.defaultLimit ?? 500,
      createdAt: now,
      updatedAt: now,
    });
  } else if ('engine' in parsed && parsed.engine === 'mysql') {
    pendingPassword = parsed.password && parsed.password.length > 0 ? parsed.password : undefined;
    profile = MysqlProfile.parse({
      id,
      engine: 'mysql',
      name: parsed.name,
      envTag: parsed.envTag,
      host: parsed.host ?? '127.0.0.1',
      port: parsed.port ?? 3306,
      database: parsed.database,
      user: parsed.user,
      hasPassword: Boolean(pendingPassword),
      sslMode: parsed.sslMode ?? 'disable',
      queryTimeoutMs: parsed.queryTimeoutMs ?? 30_000,
      defaultLimit: parsed.defaultLimit ?? 500,
      createdAt: now,
      updatedAt: now,
    });
  } else if ('engine' in parsed && parsed.engine === 'mssql') {
    pendingPassword = parsed.password && parsed.password.length > 0 ? parsed.password : undefined;
    profile = MssqlProfile.parse({
      id,
      engine: 'mssql',
      name: parsed.name,
      envTag: parsed.envTag,
      host: parsed.host ?? '127.0.0.1',
      port: parsed.port ?? 1433,
      database: parsed.database,
      user: parsed.user,
      hasPassword: Boolean(pendingPassword),
      encrypt: parsed.encrypt ?? true,
      trustServerCertificate: parsed.trustServerCertificate ?? false,
      instanceName:
        parsed.instanceName && parsed.instanceName.length > 0
          ? parsed.instanceName
          : undefined,
      queryTimeoutMs: parsed.queryTimeoutMs ?? 30_000,
      defaultLimit: parsed.defaultLimit ?? 500,
      createdAt: now,
      updatedAt: now,
    });
  } else if (parsed.kind === 'live') {
    if (!existsSync(parsed.serviceAccountPath)) {
      throw new Error(`Service-account file not found: ${parsed.serviceAccountPath}`);
    }
    profile = LiveProfile.parse({
      id,
      name: parsed.name,
      engine: 'firestore',
      kind: 'live',
      envTag: parsed.envTag,
      projectId: parsed.projectId,
      serviceAccountPath: parsed.serviceAccountPath,
      scanCap: parsed.scanCap ?? 500,
      sampleSize: parsed.sampleSize ?? 10,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    profile = EmulatorProfile.parse({
      id,
      name: parsed.name,
      engine: 'firestore',
      kind: 'emulator',
      envTag: parsed.envTag,
      projectId: parsed.projectId,
      host: parsed.host ?? '127.0.0.1',
      port: parsed.port ?? 8080,
      scanCap: parsed.scanCap ?? 500,
      sampleSize: parsed.sampleSize ?? 10,
      createdAt: now,
      updatedAt: now,
    });
  }

  const all = await loadProfiles();
  all.push(profile);
  await saveProfiles(all);

  if (pendingPassword) {
    await setProfileSecret(profile.id, pendingPassword);
  }

  return profile;
}

export async function updateProfile(id: string, update: ProfileUpdate): Promise<Profile> {
  const parsed = ProfileUpdate.parse(update);
  const all = await loadProfiles();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Profile not found: ${id}`);
  const current = all[idx];
  const now = Date.now();

  // `password` has three states across all relational engines: `null` ->
  // clear, string -> set, `undefined` -> leave existing untouched. Match
  // the LLM settings conventions so the UI stays consistent.
  async function reconcilePassword(currentHasPassword: boolean): Promise<boolean> {
    if (parsed.password === null) {
      await clearProfileSecret(current.id);
      return false;
    }
    if (typeof parsed.password === 'string' && parsed.password.length > 0) {
      await setProfileSecret(current.id, parsed.password);
      return true;
    }
    return currentHasPassword;
  }

  if (current.engine === 'postgres') {
    const hasPassword = await reconcilePassword(current.hasPassword);
    const next = PostgresProfile.parse({
      ...current,
      name: parsed.name ?? current.name,
      envTag: parsed.envTag ?? current.envTag,
      host: parsed.host ?? current.host,
      port: parsed.port ?? current.port,
      database: parsed.database ?? current.database,
      user: parsed.user ?? current.user,
      sslMode: parsed.sslMode ?? current.sslMode,
      schema: parsed.schema ?? current.schema,
      queryTimeoutMs: parsed.queryTimeoutMs ?? current.queryTimeoutMs,
      defaultLimit: parsed.defaultLimit ?? current.defaultLimit,
      hasPassword,
      updatedAt: now,
    });
    all[idx] = next;
  } else if (current.engine === 'mysql') {
    const hasPassword = await reconcilePassword(current.hasPassword);
    const next = MysqlProfile.parse({
      ...current,
      name: parsed.name ?? current.name,
      envTag: parsed.envTag ?? current.envTag,
      host: parsed.host ?? current.host,
      port: parsed.port ?? current.port,
      database: parsed.database ?? current.database,
      user: parsed.user ?? current.user,
      sslMode: parsed.sslMode ?? current.sslMode,
      queryTimeoutMs: parsed.queryTimeoutMs ?? current.queryTimeoutMs,
      defaultLimit: parsed.defaultLimit ?? current.defaultLimit,
      hasPassword,
      updatedAt: now,
    });
    all[idx] = next;
  } else if (current.engine === 'mssql') {
    const hasPassword = await reconcilePassword(current.hasPassword);
    const next = MssqlProfile.parse({
      ...current,
      name: parsed.name ?? current.name,
      envTag: parsed.envTag ?? current.envTag,
      host: parsed.host ?? current.host,
      port: parsed.port ?? current.port,
      database: parsed.database ?? current.database,
      user: parsed.user ?? current.user,
      encrypt: parsed.encrypt ?? current.encrypt,
      trustServerCertificate:
        parsed.trustServerCertificate ?? current.trustServerCertificate,
      instanceName:
        parsed.instanceName !== undefined
          ? parsed.instanceName.length > 0
            ? parsed.instanceName
            : undefined
          : current.instanceName,
      queryTimeoutMs: parsed.queryTimeoutMs ?? current.queryTimeoutMs,
      defaultLimit: parsed.defaultLimit ?? current.defaultLimit,
      hasPassword,
      updatedAt: now,
    });
    all[idx] = next;
  } else if (current.kind === 'live') {
    const next = LiveProfile.parse({
      ...current,
      name: parsed.name ?? current.name,
      envTag: parsed.envTag ?? current.envTag,
      projectId: parsed.projectId ?? current.projectId,
      serviceAccountPath: parsed.serviceAccountPath ?? current.serviceAccountPath,
      scanCap: parsed.scanCap ?? current.scanCap,
      sampleSize: parsed.sampleSize ?? current.sampleSize,
      updatedAt: now,
    });
    if (!existsSync(next.serviceAccountPath)) {
      throw new Error(`Service-account file not found: ${next.serviceAccountPath}`);
    }
    all[idx] = next;
  } else {
    const next = EmulatorProfile.parse({
      ...current,
      name: parsed.name ?? current.name,
      envTag: parsed.envTag ?? current.envTag,
      projectId: parsed.projectId ?? current.projectId,
      host: parsed.host ?? current.host,
      port: parsed.port ?? current.port,
      scanCap: parsed.scanCap ?? current.scanCap,
      sampleSize: parsed.sampleSize ?? current.sampleSize,
      updatedAt: now,
    });
    all[idx] = next;
  }

  await saveProfiles(all);
  return all[idx];
}

export async function deleteProfile(id: string): Promise<void> {
  const all = await loadProfiles();
  const target = all.find((p) => p.id === id);
  const next = all.filter((p) => p.id !== id);
  if (next.length === all.length) {
    throw new Error(`Profile not found: ${id}`);
  }
  await saveProfiles(next);
  // Drop any keychain secret tied to this profile. A no-op if nothing was
  // ever stored.
  await clearProfileSecret(id);
  // Remove any service-account JSON we copied into the app's user-data dir
  // for this profile. The helper is a no-op when the path isn't under our
  // managed directory, so user-chosen paths are always left alone.
  if (target && target.engine === 'firestore' && target.kind === 'live') {
    try {
      await removeImportedServiceAccount(target.serviceAccountPath);
    } catch {
      // Don't block deletion on cleanup failures; the profile is already gone.
    }
  }
  const active = await getActiveProfileId();
  if (active === id) await setActiveProfileId(null);
}

export async function getActiveProfileId(): Promise<string | null> {
  const data = await readFileOr<ActiveShape>(activePath(), { profileId: null });
  return data.profileId;
}

export async function setActiveProfileId(profileId: string | null): Promise<void> {
  if (profileId !== null) {
    const exists = await getProfile(profileId);
    if (!exists) throw new Error(`Profile not found: ${profileId}`);
  }
  await writeJson(activePath(), { profileId } satisfies ActiveShape);
}
