import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * firebase emulators:exec sets FIRESTORE_EMULATOR_HOST automatically. We use
 * the Admin SDK against that, which makes the test code identical to the
 * production executor path.
 */
export interface EmulatorHandle {
  app: App;
  firestore: Firestore;
  projectId: string;
  dispose(): Promise<void>;
}

let counter = 0;

export function connectEmulator(projectId = 'fqs-integration'): EmulatorHandle {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. Run these tests via "pnpm test:emulator" which wraps firebase emulators:exec.',
    );
  }
  // Admin SDK requires credentials to construct, even against the emulator.
  // The emulator ignores them, but they must be structurally valid.
  const dummyCred = cert({
    projectId,
    clientEmail: `emulator@${projectId}.iam.gserviceaccount.com`,
    privateKey:
      '-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEAssv9o4C2eO4LiFlG\nJJx5rjHPpz4ZqDkKyLa0fQw1oq6UBeFnXH0qMkGFQN59r7dsZ4Ha0cyQSwXZ2EkL\nkN0hmQIDAQABAkAAyuQ0+0ZLtPCMeGkhY4+yVYgNgxhe1BhuWqm3OdVJL5JTFO9a\nrbfeD3ozTaMqWbd9z3Ip4aNlSuNDgRmLg4zJAiEA5R9v3aGJpfF3VcnLzYslcaz0\nwRjaa2LT3rCeA7PC2x0CIQDHaKwwIbHJdnEBKZuG+K2cd61YNR1IAVr1ZjeK3ChV\nDQIgRs0QhKZdn9gYD4s+OBMv6ArCmNfD9j4BVdqj5pUKzOUCIH3mx7VmwZSUVRjT\nmYX3Hv3l+P0MH5wJMKaNnk5oqp7RAiEAu7OKXmeZ2krwx5NvVx1Fk+NjzKqk0tnT\nITjvwrGovlY=\n-----END PRIVATE KEY-----\n',
  });
  counter += 1;
  const app = initializeApp(
    {
      credential: dummyCred,
      projectId,
    },
    `fqs-integration-${Date.now()}-${counter}`,
  );
  const firestore = getFirestore(app);
  firestore.settings({ ignoreUndefinedProperties: true });
  return {
    app,
    firestore,
    projectId,
    async dispose() {
      await deleteApp(app);
    },
  };
}

export async function clearCollection(
  firestore: Firestore,
  collection: string,
): Promise<void> {
  const snap = await firestore.collection(collection).get();
  const batch = firestore.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  if (snap.size > 0) await batch.commit();
}
