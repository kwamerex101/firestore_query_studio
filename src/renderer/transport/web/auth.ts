import { initializeApp, type FirebaseApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import type { AuthUserProfile, WebExtensions } from '../types';
import { getActiveProfileId, getFirebaseConfigFor } from './profiles';

/**
 * Firebase Auth wrapper for the web transport.
 *
 * Auth is always scoped to the *active* profile. Switching profiles signs
 * out of the previous Firebase app and re-initializes against the new
 * project. This matches the existing UX pattern (one active profile at a
 * time) and sidesteps Firebase's requirement that `initializeApp` only
 * accept one config per named app.
 */

interface ActiveCtx {
  profileId: string;
  app: FirebaseApp;
  auth: Auth;
}

let active: ActiveCtx | null = null;
const listeners = new Set<(u: AuthUserProfile | null) => void>();
let unsubscribeAuthState: (() => void) | null = null;

function toProfile(user: User | null): AuthUserProfile | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    // Prefer the primary provider so the banner can say "signed in with
    // google.com". Firebase populates `providerData[0]` for the OAuth
    // provider even when `providerId` on the user is just "firebase".
    providerId: user.providerData[0]?.providerId ?? user.providerId,
  };
}

function emit(user: AuthUserProfile | null) {
  for (const l of listeners) {
    try {
      l(user);
    } catch (err) {
      // Swallow listener errors — the banner shouldn't crash the page.
      // eslint-disable-next-line no-console
      console.error('[auth] listener threw', err);
    }
  }
}

async function ensureActive(): Promise<ActiveCtx | null> {
  const profileId = await getActiveProfileId();
  if (!profileId) {
    await detachActive();
    return null;
  }
  if (active && active.profileId === profileId) return active;

  const config = await getFirebaseConfigFor(profileId);
  if (!config) {
    await detachActive();
    return null;
  }

  await detachActive();

  // Each profile gets a uniquely named FirebaseApp to avoid the default-name
  // duplicate-init error. getApps() dedupe if the page re-runs.
  const appName = `fqs-auth-${profileId}`;
  const existing = getApps().find((a) => a.name === appName);
  const app = existing ?? initializeApp(config, appName);
  const auth = getAuth(app);

  unsubscribeAuthState = onAuthStateChanged(auth, (u) => emit(toProfile(u)));
  active = { profileId, app, auth };
  return active;
}

async function detachActive() {
  if (unsubscribeAuthState) {
    unsubscribeAuthState();
    unsubscribeAuthState = null;
  }
  // We deliberately don't call `deleteApp` — Firebase Auth holds persistent
  // listeners and tearing down the FirebaseApp can race with the
  // `onAuthStateChanged` call above. Dropping our reference is enough; the
  // next active profile init uses a different app name anyway.
  active = null;
  emit(null);
}

export const auth: WebExtensions['auth'] = {
  async getState() {
    const ctx = await ensureActive();
    if (!ctx) return null;
    return toProfile(ctx.auth.currentUser);
  },
  async signInWithGoogle() {
    const ctx = await ensureActive();
    if (!ctx) {
      throw new Error(
        'No active profile with Firebase config. Create a profile and paste your Firebase Web config first.',
      );
    }
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(ctx.auth, provider);
    const profile = toProfile(cred.user);
    if (!profile) throw new Error('Sign-in succeeded but returned no user.');
    return profile;
  },
  async signOut() {
    const ctx = await ensureActive();
    if (!ctx) return;
    await fbSignOut(ctx.auth);
  },
  subscribe(cb) {
    listeners.add(cb);
    // Fire once with the current state so late subscribers don't miss the
    // initial `onAuthStateChanged` event.
    void (async () => {
      const ctx = await ensureActive();
      cb(ctx ? toProfile(ctx.auth.currentUser) : null);
    })();
    return () => {
      listeners.delete(cb);
    };
  },
};

/**
 * Call after a profile switch or after the active profile's Firebase config
 * changes. Forces the next `auth.*` call to re-initialize against the new
 * config and refreshes subscribers.
 */
export async function invalidateAuthForActiveChange(): Promise<void> {
  await detachActive();
  // Trigger a refresh for any subscribers so they re-render with the new
  // profile's auth state (often `null` — pending config).
  const ctx = await ensureActive();
  emit(ctx ? toProfile(ctx.auth.currentUser) : null);
}
