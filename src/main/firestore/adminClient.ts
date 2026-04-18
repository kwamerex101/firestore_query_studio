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

async function loadServiceAccount(path: string): Promise<ServiceAccount> {
  const raw = await fs.readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error(
      `Service account JSON at ${path} is missing one of: project_id, client_email, private_key.`,
    );
  }
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
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
