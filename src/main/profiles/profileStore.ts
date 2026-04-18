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
} from '@shared/types/profile';

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
  if (parsed.kind === 'live') {
    if (!existsSync(parsed.serviceAccountPath)) {
      throw new Error(`Service-account file not found: ${parsed.serviceAccountPath}`);
    }
  }
  const all = await loadProfiles();
  const now = Date.now();
  const id = randomUUID();

  const profile: Profile =
    parsed.kind === 'live'
      ? LiveProfile.parse({
          id,
          name: parsed.name,
          kind: 'live',
          envTag: parsed.envTag,
          projectId: parsed.projectId,
          serviceAccountPath: parsed.serviceAccountPath,
          scanCap: parsed.scanCap ?? 500,
          sampleSize: parsed.sampleSize ?? 10,
          createdAt: now,
          updatedAt: now,
        })
      : EmulatorProfile.parse({
          id,
          name: parsed.name,
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

  all.push(profile);
  await saveProfiles(all);
  return profile;
}

export async function updateProfile(id: string, update: ProfileUpdate): Promise<Profile> {
  const parsed = ProfileUpdate.parse(update);
  const all = await loadProfiles();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Profile not found: ${id}`);
  const current = all[idx];
  const now = Date.now();

  if (current.kind === 'live') {
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
  const next = all.filter((p) => p.id !== id);
  if (next.length === all.length) {
    throw new Error(`Profile not found: ${id}`);
  }
  await saveProfiles(next);
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
