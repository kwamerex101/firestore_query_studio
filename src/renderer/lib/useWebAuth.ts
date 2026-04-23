import { useCallback, useEffect, useState } from 'react';
import {
  capabilities,
  webExtensions,
  type AuthUserProfile,
  type FirebaseWebConfig,
} from './ipcClient';

/**
 * React hook exposing Firebase Auth state + sign-in controls on the web
 * build. Returns a stable "no-op" shape on Electron so consumers can render
 * unconditionally and feature-detect via `supported`.
 */
export interface UseWebAuth {
  /** True only in the PWA/web build. Desktop returns `false`. */
  supported: boolean;
  /** Currently signed-in user, or null when signed out / no config yet. */
  user: AuthUserProfile | null;
  /** True while the initial auth state is still resolving. */
  loading: boolean;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /** Last error from a sign-in / sign-out attempt, cleared on next try. */
  error: string | null;
}

export function useWebAuth(): UseWebAuth {
  const supported = capabilities.shell === 'web' && !!webExtensions;
  const [user, setUser] = useState<AuthUserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(supported);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported || !webExtensions) {
      setLoading(false);
      return;
    }
    const unsubscribe = webExtensions.auth.subscribe((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, [supported]);

  const signInWithGoogle = useCallback(async () => {
    if (!webExtensions) throw new Error('Auth is not available in this build.');
    setError(null);
    try {
      await webExtensions.auth.signInWithGoogle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!webExtensions) return;
    setError(null);
    try {
      await webExtensions.auth.signOut();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    }
  }, []);

  return { supported, user, loading, signInWithGoogle, signOut, error };
}

/**
 * Read/write the active profile's Firebase Web config. Returns `{ supported:
 * false }` on Electron so callers can feature-detect.
 */
export interface UseFirebaseConfig {
  supported: boolean;
  get(profileId: string): Promise<FirebaseWebConfig | null>;
  set(profileId: string, config: FirebaseWebConfig | null): Promise<void>;
}

export function useFirebaseConfig(): UseFirebaseConfig {
  const supported = capabilities.shell === 'web' && !!webExtensions;
  return {
    supported,
    async get(profileId) {
      if (!webExtensions) return null;
      return webExtensions.firebaseConfig.get(profileId);
    },
    async set(profileId, config) {
      if (!webExtensions) {
        throw new Error('Firebase Web config is only available in the web build.');
      }
      return webExtensions.firebaseConfig.set(profileId, config);
    },
  };
}
