import { useEffect, useState } from 'react';
import { Database, Key, CheckCircle2, ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { ServiceAccountPicker } from '../components/ServiceAccountPicker';
import { useAppState } from '../state/AppState';
import { capabilities, ipc } from '../lib/ipcClient';
import { cn } from '../lib/utils';
import {
  emptyForm,
  defaultPortFor,
  buildProfileInputFromForm,
  type FormState,
} from './ProfilesPage';
import type { Engine, ProfileKind } from '@shared/types/profile';

type Step = 'welcome' | 'connect' | 'llm' | 'done';

const STEPS: Step[] = ['welcome', 'connect', 'llm', 'done'];

export function OnboardingWizard() {
  const { profiles, onboardingComplete, completeOnboarding, reloadProfiles, saveLlm } =
    useAppState();

  const [step, setStep] = useState<Step>('welcome');
  const [form, setForm] = useState<FormState>(emptyForm);
  const [profileError, setProfileError] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmError, setLlmError] = useState('');
  const [busy, setBusy] = useState(false);

  // Show only when there are no profiles and onboarding isn't done
  if (onboardingComplete || profiles.length > 0) return null;

  const stepIndex = STEPS.indexOf(step);

  function next() {
    setStep(STEPS[stepIndex + 1]);
  }
  function back() {
    setStep(STEPS[stepIndex - 1]);
  }

  async function saveProfile() {
    setProfileError('');
    if (!form.name.trim()) { setProfileError('Profile name is required.'); return; }
    if (form.engine === 'firestore') {
      if (!form.projectId.trim()) { setProfileError('Firebase Project ID is required.'); return; }
      if (form.kind === 'live' && !form.serviceAccountPath.trim()) {
        setProfileError('Service account JSON path is required for live connections.'); return;
      }
    } else {
      if (!form.sqlDatabase.trim()) { setProfileError('Database name is required.'); return; }
      if (!form.sqlUser.trim()) { setProfileError('User is required.'); return; }
    }
    setBusy(true);
    try {
      const input = buildProfileInputFromForm(form);
      await ipc.profiles.create(input);
      await reloadProfiles();
      setProfileSaved(true);
      next();
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveLlmSettings() {
    setLlmError('');
    if (!llmBaseUrl.trim()) { setLlmError('API base URL is required.'); return; }
    if (!llmModel.trim()) { setLlmError('Model name is required.'); return; }
    setBusy(true);
    try {
      await saveLlm({
        baseUrl: llmBaseUrl.trim(),
        model: llmModel.trim(),
        apiKey: llmApiKey.trim() || undefined,
        timeoutMs: 30_000,
      });
      next();
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleEngineChange(engine: Engine) {
    setForm({
      ...emptyForm,
      name: form.name,
      engine,
      sqlPort: defaultPortFor(engine),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative mx-4 w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
        {/* Progress bar */}
        <div className="flex h-1 overflow-hidden rounded-t-xl bg-border">
          <div
            className="bg-primary transition-all duration-500"
            style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="p-6 sm:p-8">
          {step === 'welcome' && <WelcomeStep onNext={next} />}
          {step === 'connect' && (
            <ConnectStep
              form={form}
              setForm={setForm}
              error={profileError}
              busy={busy}
              onBack={back}
              onNext={saveProfile}
              onEngineChange={handleEngineChange}
            />
          )}
          {step === 'llm' && (
            <LlmStep
              baseUrl={llmBaseUrl}
              setBaseUrl={setLlmBaseUrl}
              model={llmModel}
              setModel={setLlmModel}
              apiKey={llmApiKey}
              setApiKey={setLlmApiKey}
              error={llmError}
              busy={busy}
              onBack={back}
              onNext={saveLlmSettings}
              onSkip={next}
            />
          )}
          {step === 'done' && (
            <DoneStep profileSaved={profileSaved} onFinish={completeOnboarding} />
          )}
        </div>
      </div>
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext(): void }) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-glow-primary">
        <Database size={28} />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight">Welcome to Firestore Query Studio</h2>
        <p className="text-sm text-muted-foreground">
          Query your databases in plain English. Let's get you connected — it takes about 2 minutes.
        </p>
      </div>
      <div className="flex flex-col gap-2 text-left w-full rounded-lg border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">You'll set up:</p>
        <ol className="list-decimal list-inside space-y-1 pl-1">
          <li>A database connection (Firestore, PostgreSQL, MySQL, or SQL Server)</li>
          <li>An AI model to translate your questions into queries</li>
        </ol>
      </div>
      <Button className="w-full" onClick={onNext}>
        Get started <ChevronRight size={14} className="ml-1" />
      </Button>
    </div>
  );
}

function ConnectStep({
  form,
  setForm,
  error,
  busy,
  onBack,
  onNext,
  onEngineChange,
}: {
  form: FormState;
  setForm(f: FormState): void;
  error: string;
  busy: boolean;
  onBack(): void;
  onNext(): void;
  onEngineChange(e: Engine): void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Connect a database</h2>
        <p className="text-sm text-muted-foreground">Give your connection a name and fill in the details.</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="label">Connection name</label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="My project (dev)"
            autoFocus
          />
        </div>

        <div>
          <label className="label">Database type</label>
          <Select value={form.engine} onChange={(e) => onEngineChange(e.target.value as Engine)}>
            <option value="firestore">Firestore</option>
            {capabilities.postgresProfiles && <option value="postgres">PostgreSQL</option>}
            {capabilities.mysqlProfiles && <option value="mysql">MySQL / MariaDB</option>}
            {capabilities.mssqlProfiles && <option value="mssql">SQL Server</option>}
          </Select>
        </div>

        {form.engine === 'firestore' ? (
          <FirestoreQuickFields form={form} setForm={setForm} />
        ) : (
          <SqlQuickFields form={form} setForm={setForm} />
        )}
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft size={14} className="mr-1" /> Back
        </Button>
        <Button className="flex-1" onClick={onNext} disabled={busy}>
          {busy ? 'Saving…' : 'Save & continue'}
          {!busy && <ChevronRight size={14} className="ml-1" />}
        </Button>
      </div>
    </div>
  );
}

function FirestoreQuickFields({ form, setForm }: { form: FormState; setForm(f: FormState): void }) {
  const isWeb = capabilities.shell === 'web';
  // In web builds the Admin SDK isn't available — force emulator kind so we
  // never render the service-account picker (browsers can't resolve absolute
  // file paths, so Drop/Browse can't produce a usable path for live profiles).
  useEffect(() => {
    if (isWeb && form.kind !== 'emulator') {
      setForm({ ...form, kind: 'emulator', serviceAccountPath: '' });
    }
  }, [isWeb, form, setForm]);
  return (
    <>
      {!isWeb && (
        <div>
          <label className="label">Kind</label>
          <Select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as ProfileKind })}
          >
            <option value="emulator">Emulator (local)</option>
            <option value="live">Live (Admin SDK)</option>
          </Select>
        </div>
      )}
      {isWeb && (
        <p className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
          Browser builds connect to the Firestore <strong>Emulator</strong> directly.
          For a live Firestore project, finish the wizard with any values, then open{' '}
          <strong>Profiles</strong> and add your Firebase Web config — the browser uses
          Firebase Auth, not service-account JSON.
        </p>
      )}
      <div>
        <label className="label">Firebase Project ID</label>
        <Input
          value={form.projectId}
          onChange={(e) => setForm({ ...form, projectId: e.target.value })}
          placeholder="my-project-123"
        />
      </div>
      {form.kind === 'live' ? (
        <div>
          <ServiceAccountPicker
            value={form.serviceAccountPath}
            onChange={(path) => setForm({ ...form, serviceAccountPath: path })}
            projectId={form.projectId}
            importCopy={form.importCopy}
            onImportChange={(next) => setForm({ ...form, importCopy: next })}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Firebase console → Project settings → Service accounts → Generate new private key
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="label">Host</label>
            <Input
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
              placeholder="127.0.0.1"
            />
          </div>
          <div>
            <label className="label">Port</label>
            <Input
              value={form.port}
              onChange={(e) => setForm({ ...form, port: e.target.value })}
              placeholder="8080"
            />
          </div>
        </div>
      )}
    </>
  );
}

function SqlQuickFields({ form, setForm }: { form: FormState; setForm(f: FormState): void }) {
  const defaultPort = defaultPortFor(form.engine);
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="label">Host</label>
          <Input
            value={form.sqlHost}
            onChange={(e) => setForm({ ...form, sqlHost: e.target.value })}
            placeholder="127.0.0.1"
          />
        </div>
        <div>
          <label className="label">Port</label>
          <Input
            value={form.sqlPort}
            onChange={(e) => setForm({ ...form, sqlPort: e.target.value })}
            placeholder={defaultPort}
          />
        </div>
      </div>
      <div>
        <label className="label">Database</label>
        <Input
          value={form.sqlDatabase}
          onChange={(e) => setForm({ ...form, sqlDatabase: e.target.value })}
          placeholder="mydb"
        />
      </div>
      <div>
        <label className="label">User</label>
        <Input
          value={form.sqlUser}
          onChange={(e) => setForm({ ...form, sqlUser: e.target.value })}
          placeholder="postgres"
        />
      </div>
      <div>
        <label className="label">Password</label>
        <Input
          type="password"
          value={form.sqlPassword}
          onChange={(e) => setForm({ ...form, sqlPassword: e.target.value })}
          placeholder="(optional)"
        />
      </div>
    </>
  );
}

function LlmStep({
  baseUrl,
  setBaseUrl,
  model,
  setModel,
  apiKey,
  setApiKey,
  error,
  busy,
  onBack,
  onNext,
  onSkip,
}: {
  baseUrl: string;
  setBaseUrl(v: string): void;
  model: string;
  setModel(v: string): void;
  apiKey: string;
  setApiKey(v: string): void;
  error: string;
  busy: boolean;
  onBack(): void;
  onNext(): void;
  onSkip(): void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Key size={16} />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight">Set up your AI model</h2>
          <p className="text-sm text-muted-foreground">
            Firestore Query Studio translates your questions into queries using any OpenAI-compatible API.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="label">API base URL</label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            autoFocus
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            OpenAI: <span className="font-mono">https://api.openai.com/v1</span> · Ollama: <span className="font-mono">http://localhost:11434/v1</span>
          </p>
        </div>
        <div>
          <label className="label">Model</label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
          />
        </div>
        <div>
          <label className="label">API key <span className="text-muted-foreground">(optional for local models)</span></label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft size={14} className="mr-1" /> Back
        </Button>
        <Button className="flex-1" onClick={onNext} disabled={busy}>
          {busy ? 'Saving…' : 'Save & finish'}
          {!busy && <ChevronRight size={14} className="ml-1" />}
        </Button>
      </div>
      <button
        type="button"
        onClick={onSkip}
        className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Skip for now — I'll configure this in Settings
      </button>
    </div>
  );
}

function DoneStep({
  profileSaved,
  onFinish,
}: {
  profileSaved: boolean;
  onFinish(): void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className={cn(
        'flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg',
        profileSaved ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-primary to-primary/70',
      )}>
        <CheckCircle2 size={28} />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight">You're all set!</h2>
        <p className="text-sm text-muted-foreground">
          {profileSaved
            ? 'Your database is connected and ready. Ask your first question to get started.'
            : 'You can add a database connection any time from the Profiles tab.'}
        </p>
      </div>
      <Button className="w-full" onClick={onFinish}>
        Start exploring
      </Button>
    </div>
  );
}
