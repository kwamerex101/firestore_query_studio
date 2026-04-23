import { useEffect, useMemo, useState } from 'react';
import type { Profile } from '@shared/types/profile';
import type { FirebaseWebConfig } from '../lib/ipcClient';
import { useFirebaseConfig } from '../lib/useWebAuth';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Input, Textarea } from './ui/input';
import { useToast } from './ui/toast';

interface Props {
  profile: Profile;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

interface FormState {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId: string;
  storageBucket: string;
}

const EMPTY: FormState = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
  messagingSenderId: '',
  storageBucket: '',
};

function fromConfig(c: FirebaseWebConfig): FormState {
  return {
    apiKey: c.apiKey,
    authDomain: c.authDomain,
    projectId: c.projectId,
    appId: c.appId ?? '',
    messagingSenderId: c.messagingSenderId ?? '',
    storageBucket: c.storageBucket ?? '',
  };
}

/**
 * Try hard to accept whatever the user paste-dumps from the Firebase
 * console: either the raw JSON object, the `initializeApp({...})` snippet,
 * or a `const firebaseConfig = {...}` declaration. We extract the first
 * `{...}` block and JSON.parse it with a tolerant reviver.
 */
function parsePastedSnippet(input: string): Partial<FirebaseWebConfig> | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  // Replace unquoted keys and single quotes with JSON-friendly forms. This
  // is a best-effort lexer, not a JS parser — good enough for the shape of
  // config snippets the Firebase console emits.
  const jsonLike = match[0]
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')
    .replace(/,\s*([}\]])/g, '$1');
  try {
    const parsed = JSON.parse(jsonLike) as Partial<FirebaseWebConfig>;
    return parsed;
  } catch {
    return null;
  }
}

export function FirebaseWebConfigDialog({
  profile,
  open,
  onClose,
  onSaved,
}: Props) {
  const { supported, get, set } = useFirebaseConfig();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !supported) return;
    setLoading(true);
    get(profile.id)
      .then((c) => setForm(c ? fromConfig(c) : EMPTY))
      .catch((err) =>
        toast.push(err instanceof Error ? err.message : String(err), 'error'),
      )
      .finally(() => setLoading(false));
  }, [open, supported, profile.id]);

  const valid = useMemo(
    () =>
      form.apiKey.trim().length > 0 &&
      form.authDomain.trim().length > 0 &&
      form.projectId.trim().length > 0,
    [form],
  );

  if (!supported) return null;

  function applyRaw() {
    const parsed = parsePastedSnippet(raw);
    if (!parsed) {
      toast.push(
        'Could not parse the pasted snippet — make sure it contains a JavaScript/JSON config object.',
        'error',
      );
      return;
    }
    setForm({
      apiKey: parsed.apiKey ?? form.apiKey,
      authDomain: parsed.authDomain ?? form.authDomain,
      projectId: parsed.projectId ?? form.projectId,
      appId: parsed.appId ?? form.appId,
      messagingSenderId: parsed.messagingSenderId ?? form.messagingSenderId,
      storageBucket: parsed.storageBucket ?? form.storageBucket,
    });
    setRaw('');
    toast.push('Parsed config — review fields and save.', 'success');
  }

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      const config: FirebaseWebConfig = {
        apiKey: form.apiKey.trim(),
        authDomain: form.authDomain.trim(),
        projectId: form.projectId.trim(),
      };
      if (form.appId.trim()) config.appId = form.appId.trim();
      if (form.messagingSenderId.trim())
        config.messagingSenderId = form.messagingSenderId.trim();
      if (form.storageBucket.trim())
        config.storageBucket = form.storageBucket.trim();
      await set(profile.id, config);
      toast.push('Firebase config saved.', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setSaving(true);
    try {
      await set(profile.id, null);
      setForm(EMPTY);
      toast.push('Firebase config cleared.', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Firebase Web config"
      description={`Paste your Firebase console config for profile "${profile.name}". These values are public — access is controlled by your Security Rules + Firebase Auth.`}
      className="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={clear} disabled={saving || loading}>
            Clear saved config
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={!valid || saving || loading}
              loading={saving}
            >
              Save config
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4">
        <div>
          <label className="label">Paste snippet from Firebase console</label>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            placeholder={`const firebaseConfig = {\n  apiKey: "AIza…",\n  authDomain: "my-app.firebaseapp.com",\n  projectId: "my-app",\n  ...\n};`}
          />
          <div className="mt-2">
            <Button variant="default" onClick={applyRaw} disabled={!raw.trim()}>
              Parse & fill fields
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="API key"
            value={form.apiKey}
            onChange={(v) => setForm({ ...form, apiKey: v })}
            placeholder="AIza…"
            required
          />
          <Field
            label="Auth domain"
            value={form.authDomain}
            onChange={(v) => setForm({ ...form, authDomain: v })}
            placeholder="my-app.firebaseapp.com"
            required
          />
          <Field
            label="Project ID"
            value={form.projectId}
            onChange={(v) => setForm({ ...form, projectId: v })}
            placeholder="my-app"
            required
          />
          <Field
            label="App ID"
            value={form.appId}
            onChange={(v) => setForm({ ...form, appId: v })}
            placeholder="1:123:web:…"
          />
          <Field
            label="Messaging sender ID"
            value={form.messagingSenderId}
            onChange={(v) => setForm({ ...form, messagingSenderId: v })}
            placeholder="123456789"
          />
          <Field
            label="Storage bucket"
            value={form.storageBucket}
            onChange={(v) => setForm({ ...form, storageBucket: v })}
            placeholder="my-app.appspot.com"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Before you can read any data you must authorize this origin in the
          Firebase console (<span className="font-medium">Authentication → Settings → Authorized domains</span>) and enable the
          Google sign-in provider. Firestore Security Rules then decide what
          your account can actually read.
        </p>
      </div>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="label">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
