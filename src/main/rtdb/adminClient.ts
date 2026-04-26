import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import type { RtdbEmulatorProfile, RtdbLiveProfile } from '@shared/types/profile';
import { loadServiceAccount } from '../firestore/adminClient';
import type { RtdbHandle } from './types';

function dummyCert(projectId: string) {
  return cert({
    projectId,
    clientEmail: `emulator@${projectId}.iam.gserviceaccount.com`,
    privateKey:
      '-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEAssv9o4C2eO4LiFlG\nJJx5rjHPpz4ZqDkKyLa0fQw1oq6UBeFnXH0qMkGFQN59r7dsZ4Ha0cyQSwXZ2EkL\nkN0hmQIDAQABAkAAyuQ0+0ZLtPCMeGkhY4+yVYgNgxhe1BhuWqm3OdVJL5JTFO9a\nrbfeD3ozTaMqWbd9z3Ip4aNlSuNDgRmLg4zJAiEA5R9v3aGJpfF3VcnLzYslcaz0\nwRjaa2LT3rCeA7PC2x0CIQDHaKwwIbHJdnEBKZuG+K2cd61YNR1IAVr1ZjeK3ChV\nDQIgRs0QhKZdn9gYD4s+OBMv6ArCmNfD9j4BVdqj5pUKzOUCIH3mx7VmwZSUVRjT\nmYX3Hv3l+P0MH5wJMKaNnk5oqp7RAiEAu7OKXmeZ2krwx5NvVx1Fk+NjzKqk0tnT\nITjvwrGovlY=\n-----END PRIVATE KEY-----\n',
  });
}

export async function connectRtdbLive(profile: RtdbLiveProfile): Promise<RtdbHandle> {
  const creds = await loadServiceAccount(profile.serviceAccountPath);
  if (creds.projectId !== profile.projectId) {
    throw new Error(
      `Service account project_id (${creds.projectId}) does not match profile projectId (${profile.projectId}).`,
    );
  }
  const app: App = initializeApp(
    {
      credential: cert(creds),
      projectId: profile.projectId,
      databaseURL: profile.databaseUrl,
    },
    `fqs-rtdb-live-${profile.id}-${Date.now()}`,
  );
  const database = getDatabase(app);
  return {
    profileId: profile.id,
    projectId: profile.projectId,
    kind: 'live',
    database,
    async dispose() {
      await deleteApp(app);
    },
  };
}

/**
 * Binds the RTDB emulator. Mutates `process.env.FIREBASE_DATABASE_EMULATOR_HOST`
 * and restores the previous value on dispose.
 */
export async function connectRtdbEmulator(profile: RtdbEmulatorProfile): Promise<RtdbHandle> {
  const prev = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  const hostport = `${profile.host}:${profile.port}`;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = hostport;
  const app: App = initializeApp(
    {
      credential: dummyCert(profile.projectId),
      projectId: profile.projectId,
      databaseURL: profile.databaseUrl,
    },
    `fqs-rtdb-emu-${profile.id}-${Date.now()}`,
  );
  const database = getDatabase(app);
  return {
    profileId: profile.id,
    projectId: profile.projectId,
    kind: 'emulator',
    database,
    async dispose() {
      try {
        await deleteApp(app);
      } finally {
        if (prev === undefined) {
          delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;
        } else {
          process.env.FIREBASE_DATABASE_EMULATOR_HOST = prev;
        }
      }
    },
  };
}
