import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import {
  type FirebaseWebConfig,
  getActiveProfileId,
  getFirebaseConfigFor,
} from './profiles';

/**
 * Lazy per-profile Firebase Web SDK initialization.
 *
 * We keep a cache keyed by `${profileId}:${projectId}` so re-activating the
 * same profile reuses the same `FirebaseApp` and `Firestore` instance.
 * `initializeApp` throws if called twice with the same (default) name; we
 * name each app after the profile id to sidestep that.
 */

interface CachedApp {
  app: FirebaseApp;
  firestore: Firestore;
  config: FirebaseWebConfig;
}

const cache = new Map<string, CachedApp>();

export class WebProfileNotConfiguredError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'WebProfileNotConfiguredError';
    this.code = code;
  }
}

export async function getFirestoreForActive(): Promise<{
  firestore: Firestore;
  profileId: string;
  config: FirebaseWebConfig;
}> {
  const profileId = await getActiveProfileId();
  if (!profileId) {
    throw new WebProfileNotConfiguredError(
      'No active profile. Create a Firestore profile and set it active before running queries.',
      'NO_ACTIVE_PROFILE',
    );
  }

  const config = await getFirebaseConfigFor(profileId);
  if (!config) {
    throw new WebProfileNotConfiguredError(
      'This profile has no Firebase Web config. Paste your Firebase project config into the profile to connect.',
      'PROFILE_NOT_CONFIGURED',
    );
  }

  const cacheKey = `${profileId}:${config.projectId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return { firestore: cached.firestore, profileId, config: cached.config };
  }

  // `initializeApp` rejects duplicate default-name calls, so name each app
  // after the profile id. Strip the key when the caller re-saves config so
  // stale handles are dropped.
  const app = initializeApp(config, `fqs-${profileId}`);
  const firestore = getFirestore(app);
  cache.set(cacheKey, { app, firestore, config });
  return { firestore, profileId, config };
}

/**
 * Drop the cached `FirebaseApp` for a profile. Call this whenever the
 * profile's Firebase config changes — the Firebase Web SDK retains its
 * options at init time and refuses to mutate them.
 */
export function invalidateProfile(profileId: string): void {
  for (const [key, cached] of cache.entries()) {
    if (key.startsWith(`${profileId}:`)) {
      // Firebase Web SDK has a `deleteApp` helper but `cache.delete` is
      // sufficient — we just want future callers to re-init.
      cache.delete(key);
      void cached;
    }
  }
}
