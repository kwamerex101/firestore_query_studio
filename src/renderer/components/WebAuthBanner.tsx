import { useState } from 'react';
import { LogIn, LogOut, ShieldAlert } from 'lucide-react';
import { useAppState } from '../state/AppState';
import { useWebAuth } from '../lib/useWebAuth';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

/**
 * Thin status/action banner for the PWA build.
 *
 *   - Identity row: "Signed in as <user> · <projectId>" + Sign out. On the
 *     desktop build this component renders `null` so the Electron app
 *     doesn't grow a redundant "signed in as…" chrome line.
 *   - Security row: one-liner reminding users that API keys + Firebase
 *     configs live in the browser's IndexedDB (encrypted but device-local).
 */
export function WebAuthBanner() {
  const { activeProfile } = useAppState();
  const { supported, user, loading, signInWithGoogle, signOut, error } =
    useWebAuth();
  const [pending, setPending] = useState(false);

  if (!supported) return null;
  if (!activeProfile) return null;

  const projectId =
    activeProfile.engine === 'firestore' ? activeProfile.projectId : null;

  async function handleSignIn() {
    setPending(true);
    try {
      await signInWithGoogle();
    } catch {
      // Error already surfaced via the hook's `error` state.
    } finally {
      setPending(false);
    }
  }

  async function handleSignOut() {
    setPending(true);
    try {
      await signOut();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col border-b border-border bg-card/60 backdrop-blur-sm animate-fade-in">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs sm:px-4">
        {user ? (
          <>
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                className="h-5 w-5 rounded-full border border-border"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
                {(user.displayName ?? user.email ?? '?')[0]?.toUpperCase()}
              </span>
            )}
            <span className="font-medium">
              {user.displayName ?? user.email ?? user.uid.slice(0, 8)}
            </span>
            {projectId ? (
              <span className="text-muted-foreground">
                on <span className="font-mono text-foreground/80">{projectId}</span>
              </span>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSignOut}
              disabled={pending}
              className="ml-auto h-6 px-2 text-[11px]"
            >
              <LogOut size={11} />
              Sign out
            </Button>
          </>
        ) : (
          <>
            <ShieldAlert size={12} className="text-env-staging" />
            <span className="text-muted-foreground">
              {loading
                ? 'Checking sign-in state…'
                : projectId
                  ? `Not signed in to ${projectId}. Firestore calls will fail until you authenticate.`
                  : 'Not signed in. Authenticate against your Firebase project to query.'}
            </span>
            <Button
              size="sm"
              variant="primary"
              onClick={handleSignIn}
              disabled={pending || loading}
              loading={pending}
              className="ml-auto h-6 px-2 text-[11px]"
              title="Sign in with Google"
            >
              <LogIn size={11} />
              Sign in with Google
            </Button>
          </>
        )}
      </div>
      {error ? (
        <div className="border-t border-destructive/40 bg-destructive/10 px-3 py-1 text-[11px] text-destructive sm:px-4">
          {error}
        </div>
      ) : null}
      <div
        className={cn(
          'flex items-center gap-1.5 border-t border-border/60 bg-secondary/30 px-3 py-1 text-[10px] text-muted-foreground sm:px-4',
        )}
      >
        <ShieldAlert size={10} className="shrink-0" />
        <span className="leading-tight">
          BYOK storage: API keys and Firebase configs are kept only in this
          browser's IndexedDB. Encryption is device-local and weaker than the
          desktop app's OS keychain — avoid for shared machines.
        </span>
      </div>
    </div>
  );
}
