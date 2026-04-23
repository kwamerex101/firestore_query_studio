import { promises as fs } from 'node:fs';
import {
  cert,
  deleteApp,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { LiveProfile, EmulatorProfile } from '@shared/types/profile';
import type { FirestoreHandle } from './types';

export type ServiceAccountFileMeta = {
  projectId: string;
  clientEmail: string;
};

/**
 * Read a service-account JSON from disk and validate the minimum set of
 * fields required by `firebase-admin`. Exported so dialog code can use the
 * same validation at pick-time without duplicating field-name magic strings.
 */
export async function loadServiceAccount(path: string): Promise<ServiceAccount> {
  const raw = await fs.readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Service account JSON at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { project_id?: unknown }).project_id !== 'string' ||
    typeof (parsed as { client_email?: unknown }).client_email !== 'string' ||
    typeof (parsed as { private_key?: unknown }).private_key !== 'string'
  ) {
    throw new Error(
      `Service account JSON at ${path} is missing one of: project_id, client_email, private_key.`,
    );
  }
  const obj = parsed as { project_id: string; client_email: string; private_key: string };
  return {
    projectId: obj.project_id,
    clientEmail: obj.client_email,
    privateKey: obj.private_key,
  };
}

export async function connectLive(profile: LiveProfile): Promise<FirestoreHandle> {
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
    },
    `fqs-live-${profile.id}-${Date.now()}`,
  );
  const firestore = getFirestore(app);
  return {
    profileId: profile.id,
    projectId: profile.projectId,
    kind: 'live',
    firestore,
    async dispose() {
      await deleteApp(app);
    },
  };
}

export async function connectEmulator(profile: EmulatorProfile): Promise<FirestoreHandle> {
  process.env.FIRESTORE_EMULATOR_HOST = `${profile.host}:${profile.port}`;
  const app: App = initializeApp(
    {
      projectId: profile.projectId,
    },
    `fqs-emu-${profile.id}-${Date.now()}`,
  );
  const firestore = getFirestore(app);
  return {
    profileId: profile.id,
    projectId: profile.projectId,
    kind: 'emulator',
    firestore,
    async dispose() {
      await deleteApp(app);
    },
  };
}
