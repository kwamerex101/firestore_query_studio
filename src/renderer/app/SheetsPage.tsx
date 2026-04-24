import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, LogIn, LogOut, Save, Sheet } from 'lucide-react';
import type {
  SheetsStateResult,
} from '@shared/types/ipc';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import { ipc } from '../lib/ipcClient';

/**
 * Settings → Google Sheets.
 *
 * Users paste in a Google OAuth **Desktop application** client ID + secret
 * (from Google Cloud Console → APIs & Services → Credentials), save, then
 * click "Sign in with Google". The OAuth loopback dance happens in the
 * main process; once it returns, this component re-fetches state and
 * flips the Connected chip.
 *
 * We keep credentials + tokens out of the renderer entirely — Settings
 * only shows whether they exist (`hasClient`, `hasSecret`, `connected`).
 */
export function SheetsSettingsSection() {
  const toast = useToast();
  const [state, setState] = useState<SheetsStateResult | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    void reload();
  }, []);

  async function reload() {
    try {
      const res = await ipc.sheets.get();
      setState(res);
      setClientId(res.clientId ?? '');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  async function save() {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast.push('Enter both a client ID and secret.', 'error');
      return;
    }
    setBusy(true);
    try {
      const next = await ipc.sheets.set({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      setState(next);
      setClientSecret('');
      toast.push('Google Sheets credentials saved', 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    setSigningIn(true);
    try {
      const res = await ipc.sheets.signIn();
      if (res.ok) {
        toast.push('Connected to Google Sheets', 'success');
        await reload();
      } else {
        toast.push(`Sign-in failed: ${res.message}`, 'error');
      }
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      const next = await ipc.sheets.signOut();
      setState(next);
      toast.push('Disconnected from Google Sheets', 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const hasCreds = state?.hasClient && state.hasSecret;
  const connected = !!state?.connected;

  return (
    <div className="animate-fade-in">
      <div className="mb-1 flex items-center gap-2">
        <Sheet size={16} />
        <h2 className="text-lg font-semibold tracking-tight">Google Sheets</h2>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Connect Google Sheets so you can export query results directly into a spreadsheet
        via the Download menu. Credentials are stored in the OS keychain; tokens never leave
        the main process.
      </p>

      <div className="mb-4 rounded-md border border-border bg-secondary/60 p-4 text-sm text-muted-foreground animate-fade-in-up">
        <div className="mb-2 font-medium text-foreground">One-time Google Cloud setup</div>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Open the{' '}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"
            >
              Credentials page <ExternalLink size={10} />
            </a>{' '}
            and select a project (or create one).
          </li>
          <li>
            Enable the{' '}
            <a
              href="https://console.cloud.google.com/apis/library/sheets.googleapis.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"
            >
              Sheets API <ExternalLink size={10} />
            </a>{' '}
            for the project.
          </li>
          <li>
            <strong>Create credentials → OAuth client ID</strong>. Application type:{' '}
            <span className="font-mono">Desktop app</span>. Name it anything.
          </li>
          <li>
            Add yourself as a <strong>Test user</strong> on the OAuth consent screen while the
            app is in &quot;Testing&quot; status — otherwise Google returns{' '}
            <span className="font-mono">access_denied</span>.
          </li>
          <li>Copy the client ID + secret below, save, then click <strong>Sign in</strong>.</li>
        </ol>
      </div>

      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 animate-fade-in-up">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            {connected ? (
              <>
                <CheckCircle2 size={14} className="text-env-dev" />
                Connected
              </>
            ) : hasCreds ? (
              <>Credentials saved · not signed in</>
            ) : (
              <>Not configured</>
            )}
          </div>
          {state?.scope ? (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={state.scope}>
              scope: <span className="font-mono">{state.scope}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <Button variant="ghost" onClick={signOut} disabled={busy}>
              <LogOut size={14} /> Sign out
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={signIn}
              loading={signingIn}
              disabled={!hasCreds}
              title={!hasCreds ? 'Save credentials first' : 'Open Google consent in your browser'}
            >
              {!signingIn ? <LogIn size={14} /> : null}
              {signingIn ? 'Waiting for consent…' : 'Sign in with Google'}
            </Button>
          )}
        </div>
      </div>

      <div className="card grid gap-3 animate-fade-in-up">
        <div>
          <label className="label">OAuth client ID</label>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="123-abc.apps.googleusercontent.com"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="label">
            OAuth client secret
            {state?.hasSecret ? (
              <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                (saved — re-paste to update)
              </span>
            ) : null}
          </label>
          <Input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={state?.hasSecret ? '•••••••• re-paste to replace' : 'GOCSPX-...'}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={save}
            loading={busy}
            disabled={!clientId.trim() || !clientSecret.trim()}
          >
            {!busy ? <Save size={14} /> : null}
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
