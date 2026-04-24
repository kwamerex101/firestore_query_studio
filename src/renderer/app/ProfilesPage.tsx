import { useEffect, useState, type ReactNode } from 'react';
import {
  Plus,
  Trash2,
  Check,
  Edit2,
  Info,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Copy,
  RefreshCw,
  Pencil,
  AlertCircle,
} from 'lucide-react';
import type {
  Profile,
  ProfileInput,
  ProfileKind,
  EnvTag,
  Engine,
  SqlDialect,
  SslMode,
} from '@shared/types/profile';
import type { SqlProbeDraft } from '@shared/types/ipc';
import { useAppState } from '../state/AppState';
import { Button } from '../components/ui/button';
import { Input, Textarea } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Dialog } from '../components/ui/dialog';
import { InfoTip } from '../components/ui/tooltip';
import { EnvBadge, EngineBadge } from '../components/ui/badge';
import { useToast } from '../components/ui/toast';
import { ServiceAccountPicker } from '../components/ServiceAccountPicker';
import { FirebaseWebConfigDialog } from '../components/FirebaseWebConfigDialog';
import { capabilities, ipc } from '../lib/ipcClient';
import { explainSqlProbeError, explainRunError } from '@shared/probeErrorExplain';
import { cn } from '../lib/utils';

export type FormState = {
  name: string;
  engine: Engine;
  envTag: EnvTag;

  // Firestore
  kind: ProfileKind;
  projectId: string;
  serviceAccountPath: string;
  /**
   * UI-only flag. When true, we copy the selected service-account JSON into
   * the app's user-data dir at save time and persist the copy's path in
   * `serviceAccountPath`. Not persisted to profiles.json.
   */
  importCopy: boolean;
  host: string;
  port: string;
  scanCap: string;
  sampleSize: string;

  // Shared SQL (Postgres / MySQL / MSSQL)
  sqlHost: string;
  sqlPort: string;
  sqlDatabase: string;
  sqlUser: string;
  sqlPassword: string;
  /**
   * When editing a relational profile, this mirrors `hasPassword` so we can
   * render a "Clear" affordance. Not persisted.
   */
  sqlPasswordTouched: boolean;
  sslMode: SslMode;
  /** Postgres-only. */
  pgSchema: string;
  queryTimeoutMs: string;
  defaultLimit: string;

  // MSSQL-only
  mssqlEncrypt: boolean;
  mssqlTrustServerCertificate: boolean;
  mssqlInstanceName: string;

  // BigQuery-only
  bqDefaultDataset: string;
  bqLocation: string;

  // File-backed only
  fileSourcePath: string;
  fileKind: 'csv' | 'xlsx';
};

export const emptyForm: FormState = {
  name: '',
  engine: 'firestore',
  envTag: 'dev',

  kind: 'emulator',
  projectId: '',
  serviceAccountPath: '',
  importCopy: false,
  host: '127.0.0.1',
  port: '8080',
  scanCap: '500',
  sampleSize: '10',

  sqlHost: '127.0.0.1',
  sqlPort: '5432',
  sqlDatabase: '',
  sqlUser: '',
  sqlPassword: '',
  sqlPasswordTouched: false,
  sslMode: 'disable',
  pgSchema: 'public',
  queryTimeoutMs: '30000',
  defaultLimit: '500',

  mssqlEncrypt: true,
  mssqlTrustServerCertificate: false,
  mssqlInstanceName: '',

  bqDefaultDataset: '',
  bqLocation: '',

  fileSourcePath: '',
  fileKind: 'csv',
};

export function defaultPortFor(engine: Engine): string {
  switch (engine) {
    case 'postgres':
      return '5432';
    case 'mysql':
      return '3306';
    case 'mssql':
      return '1433';
    default:
      return '8080';
  }
}

export function buildProfileInputFromForm(form: FormState): ProfileInput {
  if (form.engine === 'postgres') {
    const base = {
      engine: 'postgres' as const,
      name: form.name.trim(),
      envTag: form.envTag,
      host: form.sqlHost.trim() || '127.0.0.1',
      port: Number(form.sqlPort) || 5432,
      database: form.sqlDatabase.trim(),
      user: form.sqlUser.trim(),
      sslMode: form.sslMode,
      schema: form.pgSchema.trim() || 'public',
      queryTimeoutMs: Number(form.queryTimeoutMs) || 30_000,
      defaultLimit: Number(form.defaultLimit) || 500,
    };
    return form.sqlPassword.length > 0
      ? { ...base, password: form.sqlPassword }
      : base;
  }
  if (form.engine === 'mysql') {
    const base = {
      engine: 'mysql' as const,
      name: form.name.trim(),
      envTag: form.envTag,
      host: form.sqlHost.trim() || '127.0.0.1',
      port: Number(form.sqlPort) || 3306,
      database: form.sqlDatabase.trim(),
      user: form.sqlUser.trim(),
      sslMode: form.sslMode,
      queryTimeoutMs: Number(form.queryTimeoutMs) || 30_000,
      defaultLimit: Number(form.defaultLimit) || 500,
    };
    return form.sqlPassword.length > 0
      ? { ...base, password: form.sqlPassword }
      : base;
  }
  if (form.engine === 'mssql') {
    const base = {
      engine: 'mssql' as const,
      name: form.name.trim(),
      envTag: form.envTag,
      host: form.sqlHost.trim() || '127.0.0.1',
      port: Number(form.sqlPort) || 1433,
      database: form.sqlDatabase.trim(),
      user: form.sqlUser.trim(),
      encrypt: form.mssqlEncrypt,
      trustServerCertificate: form.mssqlTrustServerCertificate,
      instanceName:
        form.mssqlInstanceName.trim().length > 0
          ? form.mssqlInstanceName.trim()
          : undefined,
      queryTimeoutMs: Number(form.queryTimeoutMs) || 30_000,
      defaultLimit: Number(form.defaultLimit) || 500,
    };
    return form.sqlPassword.length > 0
      ? { ...base, password: form.sqlPassword }
      : base;
  }
  if (form.engine === 'bigquery') {
    return {
      engine: 'bigquery' as const,
      name: form.name.trim(),
      envTag: form.envTag,
      projectId: form.projectId.trim(),
      serviceAccountPath: form.serviceAccountPath.trim(),
      defaultDataset: form.bqDefaultDataset.trim(),
      location: form.bqLocation.trim(),
      queryTimeoutMs: Number(form.queryTimeoutMs) || 60_000,
      defaultLimit: Number(form.defaultLimit) || 500,
    };
  }
  if (form.engine === 'file') {
    return {
      engine: 'file' as const,
      name: form.name.trim(),
      envTag: form.envTag,
      kind: form.fileKind,
      sourcePath: form.fileSourcePath.trim(),
      queryTimeoutMs: Number(form.queryTimeoutMs) || 30_000,
      defaultLimit: Number(form.defaultLimit) || 500,
    };
  }
  const base = {
    name: form.name.trim(),
    envTag: form.envTag,
    projectId: form.projectId.trim(),
    scanCap: Number(form.scanCap),
    sampleSize: Number(form.sampleSize),
  };
  if (form.kind === 'live') {
    return {
      kind: 'live' as const,
      ...base,
      serviceAccountPath: form.serviceAccountPath.trim(),
    };
  }
  return {
    kind: 'emulator' as const,
    ...base,
    host: form.host.trim() || '127.0.0.1',
    port: Number(form.port) || 8080,
  };
}

type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; detail?: string; elapsedMs: number }
  | { status: 'err'; code: string; message: string; elapsedMs: number };

export function ProfilesPage() {
  const { profiles, activeProfile, reloadProfiles, setActiveProfile } = useAppState();
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [showPassword, setShowPassword] = useState(false);
  const [webConfigFor, setWebConfigFor] = useState<Profile | null>(null);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setTest({ status: 'idle' });
    setShowPassword(false);
    setDialogOpen(true);
  }

  // Listen for the native menu's "File → New Profile" command.
  useEffect(() => {
    const handler = () => openNew();
    window.addEventListener('fqs:newProfile', handler);
    return () => window.removeEventListener('fqs:newProfile', handler);
  }, []);

  function openEdit(p: Profile) {
    setEditing(p);
    setTest({ status: 'idle' });
    setShowPassword(false);
    if (p.engine === 'postgres') {
      setForm({
        ...emptyForm,
        name: p.name,
        engine: 'postgres',
        envTag: p.envTag,
        sqlHost: p.host,
        sqlPort: String(p.port),
        sqlDatabase: p.database,
        sqlUser: p.user,
        sqlPassword: '',
        sqlPasswordTouched: false,
        sslMode: p.sslMode,
        pgSchema: p.schema,
        queryTimeoutMs: String(p.queryTimeoutMs),
        defaultLimit: String(p.defaultLimit),
      });
    } else if (p.engine === 'mysql') {
      setForm({
        ...emptyForm,
        name: p.name,
        engine: 'mysql',
        envTag: p.envTag,
        sqlHost: p.host,
        sqlPort: String(p.port),
        sqlDatabase: p.database,
        sqlUser: p.user,
        sqlPassword: '',
        sqlPasswordTouched: false,
        sslMode: p.sslMode,
        queryTimeoutMs: String(p.queryTimeoutMs),
        defaultLimit: String(p.defaultLimit),
      });
    } else if (p.engine === 'mssql') {
      setForm({
        ...emptyForm,
        name: p.name,
        engine: 'mssql',
        envTag: p.envTag,
        sqlHost: p.host,
        sqlPort: String(p.port),
        sqlDatabase: p.database,
        sqlUser: p.user,
        sqlPassword: '',
        sqlPasswordTouched: false,
        queryTimeoutMs: String(p.queryTimeoutMs),
        defaultLimit: String(p.defaultLimit),
        mssqlEncrypt: p.encrypt,
        mssqlTrustServerCertificate: p.trustServerCertificate,
        mssqlInstanceName: p.instanceName ?? '',
      });
    } else if (p.engine === 'bigquery') {
      setForm({
        ...emptyForm,
        name: p.name,
        engine: 'bigquery',
        envTag: p.envTag,
        projectId: p.projectId,
        serviceAccountPath: p.serviceAccountPath,
        bqDefaultDataset: p.defaultDataset,
        bqLocation: p.location,
        queryTimeoutMs: String(p.queryTimeoutMs),
        defaultLimit: String(p.defaultLimit),
      });
    } else if (p.engine === 'file') {
      setForm({
        ...emptyForm,
        name: p.name,
        engine: 'file',
        envTag: p.envTag,
        fileKind: p.kind,
        fileSourcePath: p.sourcePath,
        queryTimeoutMs: String(p.queryTimeoutMs),
        defaultLimit: String(p.defaultLimit),
      });
    } else {
      setForm({
        ...emptyForm,
        name: p.name,
        engine: 'firestore',
        envTag: p.envTag,
        kind: p.kind,
        projectId: p.projectId,
        serviceAccountPath: p.kind === 'live' ? p.serviceAccountPath : '',
        host: p.kind === 'emulator' ? p.host : '127.0.0.1',
        port: p.kind === 'emulator' ? String(p.port) : '8080',
        scanCap: String(p.scanCap),
        sampleSize: String(p.sampleSize),
      });
    }
    setDialogOpen(true);
  }

  function buildProfileInput(): ProfileInput {
    return buildProfileInputFromForm(form);
  }

  async function save() {
    setBusy(true);
    try {
      const name = form.name.trim();
      if (!name) throw new Error('Name is required.');

      async function resolveServiceAccountPath(
        profileId: string | null,
      ): Promise<string> {
        const rawPath = form.serviceAccountPath.trim();
        if (!rawPath) return rawPath;
        if (!form.importCopy) return rawPath;
        const targetId = profileId ?? `new-${Date.now()}`;
        const res = await ipc.dialog.importServiceAccount({
          path: rawPath,
          profileId: targetId,
        });
        return res.path;
      }

      if (editing) {
        if (editing.engine === 'postgres') {
          const update = {
            name,
            envTag: form.envTag,
            host: form.sqlHost.trim() || '127.0.0.1',
            port: Number(form.sqlPort) || 5432,
            database: form.sqlDatabase.trim(),
            user: form.sqlUser.trim(),
            sslMode: form.sslMode,
            schema: form.pgSchema.trim() || 'public',
            queryTimeoutMs: Number(form.queryTimeoutMs) || 30_000,
            defaultLimit: Number(form.defaultLimit) || 500,
            password:
              form.sqlPassword.length > 0 ? form.sqlPassword : undefined,
          };
          await ipc.profiles.update({ id: editing.id, update });
        } else if (editing.engine === 'mysql') {
          const update = {
            name,
            envTag: form.envTag,
            host: form.sqlHost.trim() || '127.0.0.1',
            port: Number(form.sqlPort) || 3306,
            database: form.sqlDatabase.trim(),
            user: form.sqlUser.trim(),
            sslMode: form.sslMode,
            queryTimeoutMs: Number(form.queryTimeoutMs) || 30_000,
            defaultLimit: Number(form.defaultLimit) || 500,
            password:
              form.sqlPassword.length > 0 ? form.sqlPassword : undefined,
          };
          await ipc.profiles.update({ id: editing.id, update });
        } else if (editing.engine === 'mssql') {
          const update = {
            name,
            envTag: form.envTag,
            host: form.sqlHost.trim() || '127.0.0.1',
            port: Number(form.sqlPort) || 1433,
            database: form.sqlDatabase.trim(),
            user: form.sqlUser.trim(),
            encrypt: form.mssqlEncrypt,
            trustServerCertificate: form.mssqlTrustServerCertificate,
            instanceName: form.mssqlInstanceName.trim(),
            queryTimeoutMs: Number(form.queryTimeoutMs) || 30_000,
            defaultLimit: Number(form.defaultLimit) || 500,
            password:
              form.sqlPassword.length > 0 ? form.sqlPassword : undefined,
          };
          await ipc.profiles.update({ id: editing.id, update });
        } else if (editing.engine === 'bigquery') {
          await ipc.profiles.update({
            id: editing.id,
            update: {
              name,
              envTag: form.envTag,
              projectId: form.projectId.trim(),
              serviceAccountPath: form.serviceAccountPath.trim(),
              defaultDataset: form.bqDefaultDataset.trim(),
              location: form.bqLocation.trim(),
              queryTimeoutMs: Number(form.queryTimeoutMs) || 60_000,
              defaultLimit: Number(form.defaultLimit) || 500,
            },
          });
        } else if (editing.engine === 'file') {
          // File-backed profiles are immutable past the source import — we
          // only allow metadata edits (name / env / defaults). Re-importing
          // would require deleting + recreating the profile.
          await ipc.profiles.update({
            id: editing.id,
            update: {
              name,
              envTag: form.envTag,
              queryTimeoutMs: Number(form.queryTimeoutMs) || 30_000,
              defaultLimit: Number(form.defaultLimit) || 500,
            },
          });
        } else if (editing.kind === 'live') {
          const resolvedPath = await resolveServiceAccountPath(editing.id);
          await ipc.profiles.update({
            id: editing.id,
            update: {
              name,
              envTag: form.envTag,
              projectId: form.projectId.trim(),
              serviceAccountPath: resolvedPath,
              scanCap: Number(form.scanCap),
              sampleSize: Number(form.sampleSize),
            },
          });
        } else {
          await ipc.profiles.update({
            id: editing.id,
            update: {
              name,
              envTag: form.envTag,
              projectId: form.projectId.trim(),
              host: form.host.trim() || '127.0.0.1',
              port: Number(form.port) || 8080,
              scanCap: Number(form.scanCap),
              sampleSize: Number(form.sampleSize),
            },
          });
        }
        toast.push('Profile updated', 'success');
      } else {
        const input = buildProfileInput();
        if ('engine' in input && input.engine === 'postgres') {
          if (!input.database) throw new Error('Database is required.');
          if (!input.user) throw new Error('User is required.');
        } else if ('engine' in input && input.engine === 'mysql') {
          if (!input.database) throw new Error('Database is required.');
          if (!input.user) throw new Error('User is required.');
        } else if ('engine' in input && input.engine === 'mssql') {
          if (!input.database) throw new Error('Database is required.');
          if (!input.user) throw new Error('User is required.');
        } else if (!('projectId' in input) || !input.projectId) {
          throw new Error('Firebase Project ID is required.');
        }
        if (
          !('engine' in input) &&
          'kind' in input &&
          input.kind === 'live' &&
          form.importCopy &&
          input.serviceAccountPath
        ) {
          const tempImport = await ipc.dialog.importServiceAccount({
            path: input.serviceAccountPath,
            profileId: `pending-${Date.now()}`,
          });
          const created = await ipc.profiles.create({
            ...input,
            serviceAccountPath: tempImport.path,
          });
          const finalImport = await ipc.dialog.importServiceAccount({
            path: tempImport.path,
            profileId: created.id,
          });
          if (finalImport.path !== tempImport.path) {
            await ipc.profiles.update({
              id: created.id,
              update: { serviceAccountPath: finalImport.path },
            });
          }
        } else {
          const created = await ipc.profiles.create(input);
          // Web shell: Firestore profiles need a Firebase Web config before
          // any query will work. Auto-open the config dialog right after
          // creation so the user doesn't have to hunt for the key icon.
          if (
            capabilities.shell === 'web' &&
            created.engine === 'firestore'
          ) {
            setWebConfigFor(created);
          }
        }
        toast.push('Profile created', 'success');
      }
      await reloadProfiles();
      setDialogOpen(false);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Profile) {
    const isSql =
      p.engine === 'postgres' || p.engine === 'mysql' || p.engine === 'mssql';
    const warning = isSql
      ? `Delete profile "${p.name}"? Its stored password is also removed; the database itself is untouched.`
      : `Delete profile "${p.name}"? This only removes the profile; nothing on Firestore is touched.`;
    if (!confirm(warning)) return;
    try {
      await ipc.profiles.delete({ id: p.id });
      await reloadProfiles();
      toast.push('Profile deleted', 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  async function activate(p: Profile) {
    try {
      await setActiveProfile(p.id);
      toast.push(`Activated "${p.name}"`, 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  async function testConnection() {
    if (!editing) {
      toast.push('Save the profile first, then Test.', 'info');
      return;
    }
    setTest({ status: 'running' });
    try {
      const res = await ipc.db.testConnection({ profileId: editing.id });
      if (res.ok) {
        setTest({ status: 'ok', detail: res.detail, elapsedMs: res.elapsedMs });
      } else {
        setTest({
          status: 'err',
          code: res.code,
          message: res.message,
          elapsedMs: res.elapsedMs,
        });
      }
    } catch (err) {
      setTest({
        status: 'err',
        code: 'IPC_FAILED',
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: 0,
      });
    }
  }

  return (
    <div className="h-full overflow-auto p-6 animate-fade-in">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Project profiles</h1>
          <p className="text-sm text-muted-foreground">
            Databases you can connect to. Service-account JSON is referenced by path only;
            SQL passwords live in your OS keychain.
          </p>
        </div>
        <Button variant="primary" onClick={openNew}>
          <Plus size={14} />
          New profile
        </Button>
      </div>

      {profiles.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 py-10 text-center text-sm text-muted-foreground animate-fade-in-up">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-secondary/60 text-primary">
            <Link2 size={22} />
          </div>
          <div>
            <p className="font-medium text-foreground">No connections yet</p>
            <p className="mt-1 text-xs leading-relaxed max-w-xs">
              Add a Firestore project or a SQL database to get started. You only need to do this once.
            </p>
          </div>
          <Button variant="primary" onClick={openNew}>
            <Plus size={14} />
            Connect your first database
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {profiles.map((p, idx) => {
            const isActive = activeProfile?.id === p.id;
            return (
              <div
                key={p.id}
                className="card card-interactive flex flex-col gap-2 animate-fade-in-up"
                style={{ animationDelay: `${Math.min(idx * 40, 200)}ms` }}
              >
                {isActive ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent"
                  />
                ) : null}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <EngineBadge engine={p.engine} />
                    <EnvBadge envTag={p.envTag} />
                    {isActive ? (
                      <span className="badge border-primary/40 bg-primary/15 text-primary">
                        <span
                          className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-primary shadow-glow-primary"
                          aria-hidden
                        />
                        active
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {capabilities.shell === 'web' && p.engine === 'firestore' ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setWebConfigFor(p)}
                        title="Firebase Web config"
                        aria-label="Firebase Web config"
                      >
                        <KeyRound size={14} />
                      </Button>
                    ) : null}
                    <Button size="icon" variant="ghost" onClick={() => openEdit(p)} title="Edit" aria-label="Edit">
                      <Edit2 size={14} />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(p)} title="Delete" aria-label="Delete">
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <ProfileCardDetails profile={p} />
                <div>
                  {!isActive ? (
                    <Button size="sm" onClick={() => activate(p)}>
                      <Check size={14} /> Set active
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? 'Edit profile' : 'New profile'}
        description="Profiles are stored locally. Service-account JSON is referenced by path; SQL passwords and LLM API keys live in your OS keychain."
        footer={
          <div className="flex w-full flex-col gap-3">
            <div className="flex w-full items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <TestConnectionControl
                  test={test}
                  disabled={!editing || busy}
                  onRun={testConnection}
                  hint={!editing ? 'Save first, then test.' : undefined}
                />
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={save} disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
            <TestConnectionResultCard test={test} engine={form.engine} />
          </div>
        }
      >
        <div className="grid gap-3">
          {!editing && (
            <QuickConnectInput
              onParsed={(overrides) =>
                setForm((f) => ({ ...f, ...overrides }))
              }
              disabled={busy}
            />
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Engine</label>
              <Select
                value={form.engine}
                onChange={(e) => {
                  const next = e.target.value as Engine;
                  setForm({
                    ...form,
                    engine: next,
                    sqlPort:
                      next === 'postgres' ||
                      next === 'mysql' ||
                      next === 'mssql'
                        ? defaultPortFor(next)
                        : form.sqlPort,
                  });
                }}
                disabled={!!editing}
              >
                <option value="firestore">Firebase Firestore</option>
                {capabilities.postgresProfiles ? (
                  <option value="postgres">PostgreSQL</option>
                ) : null}
                {capabilities.mysqlProfiles ? (
                  <option value="mysql">MySQL / MariaDB</option>
                ) : null}
                {capabilities.mssqlProfiles ? (
                  <option value="mssql">Microsoft SQL Server</option>
                ) : null}
                {capabilities.bigQueryProfiles ? (
                  <option value="bigquery">Google BigQuery</option>
                ) : null}
                {capabilities.fileProfiles ? (
                  <option value="file">CSV / Excel file</option>
                ) : null}
              </Select>
            </div>
            <div>
              <label className="label">
                Environment
                <InfoTip content="Purely a visual tag: dev/staging/prod. Prod profiles get a bold red banner and a confirmation dialog before each query." />
              </label>
              <Select
                value={form.envTag}
                onChange={(e) => setForm({ ...form, envTag: e.target.value as EnvTag })}
              >
                <option value="dev">dev</option>
                <option value="staging">staging</option>
                <option value="prod">prod</option>
              </Select>
            </div>
          </div>

          <div>
            <label className="label">Name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>

          {form.engine === 'firestore' ? (
            <FirestoreFields form={form} setForm={setForm} editing={!!editing} />
          ) : form.engine === 'postgres' ? (
            <PostgresFields
              form={form}
              setForm={setForm}
              editing={editing}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
            />
          ) : form.engine === 'mysql' ? (
            <MysqlFields
              form={form}
              setForm={setForm}
              editing={editing}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
            />
          ) : form.engine === 'mssql' ? (
            <MssqlFields
              form={form}
              setForm={setForm}
              editing={editing}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
            />
          ) : form.engine === 'bigquery' ? (
            <BigQueryFields form={form} setForm={setForm} />
          ) : (
            <FileFields form={form} setForm={setForm} editing={editing} />
          )}
        </div>
      </Dialog>

      {webConfigFor ? (
        <FirebaseWebConfigDialog
          profile={webConfigFor}
          open={!!webConfigFor}
          onClose={() => setWebConfigFor(null)}
          onSaved={() => void reloadProfiles()}
        />
      ) : null}
    </div>
  );
}

function ProfileCardDetails({ profile }: { profile: Profile }) {
  if (profile.engine === 'postgres') {
    return (
      <div className="text-xs text-muted-foreground">
        <div className="truncate">
          <span className="font-mono">
            {profile.user}@{profile.host}:{profile.port}/{profile.database}
          </span>
        </div>
        <div>
          schema <span className="font-mono">{profile.schema}</span> · SSL{' '}
          <span className="font-mono">{profile.sslMode}</span> · password{' '}
          <span className={profile.hasPassword ? 'font-mono text-foreground' : 'font-mono'}>
            {profile.hasPassword ? 'stored' : 'not set'}
          </span>
        </div>
        <div>
          timeout <span className="font-mono">{profile.queryTimeoutMs}ms</span> · limit{' '}
          <span className="font-mono">{profile.defaultLimit}</span>
        </div>
      </div>
    );
  }
  if (profile.engine === 'mysql') {
    return (
      <div className="text-xs text-muted-foreground">
        <div className="truncate">
          <span className="font-mono">
            {profile.user}@{profile.host}:{profile.port}/{profile.database}
          </span>
        </div>
        <div>
          SSL <span className="font-mono">{profile.sslMode}</span> · password{' '}
          <span className={profile.hasPassword ? 'font-mono text-foreground' : 'font-mono'}>
            {profile.hasPassword ? 'stored' : 'not set'}
          </span>
        </div>
        <div>
          timeout <span className="font-mono">{profile.queryTimeoutMs}ms</span> · limit{' '}
          <span className="font-mono">{profile.defaultLimit}</span>
        </div>
      </div>
    );
  }
  if (profile.engine === 'mssql') {
    return (
      <div className="text-xs text-muted-foreground">
        <div className="truncate">
          <span className="font-mono">
            {profile.user}@{profile.host}
            {profile.instanceName ? `\\${profile.instanceName}` : `:${profile.port}`}/
            {profile.database}
          </span>
        </div>
        <div>
          encrypt <span className="font-mono">{profile.encrypt ? 'yes' : 'no'}</span> · trust cert{' '}
          <span className="font-mono">
            {profile.trustServerCertificate ? 'yes' : 'no'}
          </span>{' '}
          · password{' '}
          <span className={profile.hasPassword ? 'font-mono text-foreground' : 'font-mono'}>
            {profile.hasPassword ? 'stored' : 'not set'}
          </span>
        </div>
        <div>
          timeout <span className="font-mono">{profile.queryTimeoutMs}ms</span> · limit{' '}
          <span className="font-mono">{profile.defaultLimit}</span>
        </div>
      </div>
    );
  }
  if (profile.engine === 'bigquery') {
    return (
      <div className="text-xs text-muted-foreground">
        <div className="truncate">
          <span className="font-mono">{profile.projectId}</span>
          {profile.defaultDataset && (
            <> · dataset <span className="font-mono">{profile.defaultDataset}</span></>
          )}
        </div>
        <div className="truncate" title={profile.serviceAccountPath || 'Using Application Default Credentials'}>
          auth{' '}
          <span className="font-mono">
            {profile.serviceAccountPath ? 'service account' : 'ADC'}
          </span>
          {profile.location && (
            <> · location <span className="font-mono">{profile.location}</span></>
          )}
        </div>
        <div>
          timeout <span className="font-mono">{profile.queryTimeoutMs}ms</span> · limit{' '}
          <span className="font-mono">{profile.defaultLimit}</span>
        </div>
      </div>
    );
  }
  if (profile.engine === 'file') {
    const tableCount = profile.tables.length;
    const totalRows = Object.values(profile.rowCounts).reduce((a, b) => a + b, 0);
    return (
      <div className="text-xs text-muted-foreground">
        <div className="truncate" title={profile.sourcePath}>
          <span className="font-mono">{profile.sourceName}</span>{' '}
          <span className="uppercase opacity-70">· {profile.kind}</span>
        </div>
        <div>
          {tableCount} table{tableCount === 1 ? '' : 's'} · {totalRows.toLocaleString()} row
          {totalRows === 1 ? '' : 's'}
          {profile.sizeBytes > 0 ? ` · ${Math.ceil(profile.sizeBytes / 1024)} KB` : ''}
        </div>
        <div>
          limit <span className="font-mono">{profile.defaultLimit}</span>
        </div>
      </div>
    );
  }
  // Firestore fallback.
  return (
    <div className="text-xs text-muted-foreground">
      <div>
        <span className="font-mono">{profile.projectId}</span>
      </div>
      <div className="truncate" title={profile.kind === 'live' ? profile.serviceAccountPath : undefined}>
        {profile.kind === 'live' ? (
          <>Live · <span className="font-mono">{profile.serviceAccountPath}</span></>
        ) : (
          <>Emulator · <span className="font-mono">{profile.host}:{profile.port}</span></>
        )}
      </div>
      <div>
        scanCap <span className="font-mono">{profile.scanCap}</span> · sampleSize{' '}
        <span className="font-mono">{profile.sampleSize}</span>
      </div>
    </div>
  );
}

function FirestoreFields({
  form,
  setForm,
  editing,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  editing: boolean;
}) {
  return (
    <>
      <div>
        <label className="label">Kind</label>
        <Select
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value as ProfileKind })}
          disabled={editing}
        >
          <option value="emulator">Emulator</option>
          <option value="live">Live (Admin SDK)</option>
        </Select>
      </div>
      <div>
        <label className="label">Firebase Project ID</label>
        <Input
          value={form.projectId}
          onChange={(e) => setForm({ ...form, projectId: e.target.value })}
          placeholder="my-project-123"
        />
        <HelpNotice>
          Find it in the{' '}
          <ExternalAnchor href="https://console.firebase.google.com/">
            Firebase console
          </ExternalAnchor>{' '}
          → select your project → <span className="font-medium">Project settings</span> (gear
          icon) → <span className="font-medium">General</span> tab →{' '}
          <span className="font-mono">Project ID</span>. For the emulator you can use any
          string; it just needs to match the one you use when starting the emulator.
        </HelpNotice>
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
          <HelpNotice>
            Generate one in the{' '}
            <ExternalAnchor href="https://console.firebase.google.com/">
              Firebase console
            </ExternalAnchor>{' '}
            → <span className="font-medium">Project settings</span> (gear icon) →{' '}
            <span className="font-medium">Service accounts</span> tab →{' '}
            <span className="font-medium">Generate new private key</span>. A JSON file
            downloads; drop it above or use Browse… to pick it. Admin SDK credentials
            bypass Firestore security rules — prefer the Emulator or a dev project while
            you explore.
          </HelpNotice>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">Emulator host</label>
            <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          </div>
          <div>
            <label className="label">Port</label>
            <Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">
            Scan cap (max docs per scan)
            <InfoTip content="Safety ceiling on how many documents the executor will stream in one run. Raise for large exports; lower to protect quota." />
          </label>
          <Input value={form.scanCap} onChange={(e) => setForm({ ...form, scanCap: e.target.value })} />
        </div>
        <div>
          <label className="label">
            Schema sample size
            <InfoTip content="Number of documents sampled to infer the collection's field types. Higher = more accurate; slower to refresh." />
          </label>
          <Input value={form.sampleSize} onChange={(e) => setForm({ ...form, sampleSize: e.target.value })} />
        </div>
      </div>
    </>
  );
}

interface SqlFieldsProps {
  form: FormState;
  setForm: (next: FormState) => void;
  editing: Profile | null;
  showPassword: boolean;
  setShowPassword: (next: boolean) => void;
}

/**
 * Host/port/user/password/database block shared by all three relational
 * engines. Each engine wraps this with its own dialect-specific extras
 * (e.g. Postgres schema, MSSQL encrypt toggles). Database is rendered
 * as a discoverable combobox so users can load the list from the server
 * instead of having to remember the exact name.
 */
function SqlConnectionFields({
  form,
  setForm,
  editing,
  showPassword,
  setShowPassword,
  engine,
  hostPlaceholder = '127.0.0.1',
  databasePlaceholder,
  userPlaceholder,
}: SqlFieldsProps & {
  /** Only the networked SQL engines have host/port/user — BigQuery uses service-account auth. */
  engine: Exclude<SqlDialect, 'bigquery' | 'sqlite'>;
  hostPlaceholder?: string;
  databasePlaceholder?: string;
  userPlaceholder?: string;
}) {
  const isRelational =
    editing?.engine === 'postgres' ||
    editing?.engine === 'mysql' ||
    editing?.engine === 'mssql';
  const hasStoredPassword = isRelational ? editing.hasPassword : false;
  return (
    <>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label className="label">Host</label>
          <Input
            value={form.sqlHost}
            onChange={(e) => setForm({ ...form, sqlHost: e.target.value })}
            placeholder={hostPlaceholder}
          />
        </div>
        <div className="w-24">
          <label className="label">Port</label>
          <Input
            value={form.sqlPort}
            onChange={(e) => setForm({ ...form, sqlPort: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label className="label">User</label>
        <Input
          value={form.sqlUser}
          onChange={(e) => setForm({ ...form, sqlUser: e.target.value })}
          placeholder={userPlaceholder}
        />
      </div>
      <div>
        <label className="label">Password</label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={form.sqlPassword}
            onChange={(e) =>
              setForm({ ...form, sqlPassword: e.target.value, sqlPasswordTouched: true })
            }
            placeholder={hasStoredPassword ? '(unchanged — stored in keychain)' : ''}
            className="pr-9"
          />
          <button
            type="button"
            className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasStoredPassword
            ? 'A password is stored in your OS keychain. Leave blank to keep it; type to replace.'
            : 'Stored in your OS keychain (safeStorage). Never written to profiles.json.'}
        </p>
      </div>
      <div>
        <label className="label">Database</label>
        <DatabaseCombobox
          form={form}
          setForm={setForm}
          editing={editing}
          engine={engine}
          placeholder={databasePlaceholder}
        />
      </div>
    </>
  );
}

function PostgresFields(props: SqlFieldsProps) {
  const { form, setForm } = props;
  return (
    <>
      <SqlConnectionFields
        {...props}
        engine="postgres"
        hostPlaceholder="127.0.0.1"
        databasePlaceholder="postgres"
        userPlaceholder="postgres"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Schema</label>
          <SchemaCombobox
            form={form}
            setForm={setForm}
            editing={props.editing}
            engine="postgres"
            placeholder="public"
          />
        </div>
        <div>
          <label className="label">SSL mode</label>
          <Select
            value={form.sslMode}
            onChange={(e) => setForm({ ...form, sslMode: e.target.value as SslMode })}
          >
            <option value="disable">disable</option>
            <option value="require">require</option>
            <option value="verify-full">verify-full</option>
          </Select>
        </div>
        <div>
          <label className="label">Timeout (ms)</label>
          <Input
            value={form.queryTimeoutMs}
            onChange={(e) => setForm({ ...form, queryTimeoutMs: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Default LIMIT</label>
          <Input
            value={form.defaultLimit}
            onChange={(e) => setForm({ ...form, defaultLimit: e.target.value })}
          />
        </div>
      </div>
      <HelpNotice>
        PostgreSQL profiles support connection testing, schema browsing, and
        natural-language SQL queries (read-only). Writes are rejected by the
        built-in safety gate.
      </HelpNotice>
    </>
  );
}

function MysqlFields(props: SqlFieldsProps) {
  const { form, setForm } = props;
  return (
    <>
      <SqlConnectionFields
        {...props}
        engine="mysql"
        hostPlaceholder="127.0.0.1"
        databasePlaceholder="mydb"
        userPlaceholder="root"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">SSL mode</label>
          <Select
            value={form.sslMode}
            onChange={(e) => setForm({ ...form, sslMode: e.target.value as SslMode })}
          >
            <option value="disable">disable</option>
            <option value="require">require</option>
            <option value="verify-full">verify-full</option>
          </Select>
        </div>
        <div>
          <label className="label">Query timeout (ms)</label>
          <Input
            value={form.queryTimeoutMs}
            onChange={(e) => setForm({ ...form, queryTimeoutMs: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Default LIMIT</label>
          <Input
            value={form.defaultLimit}
            onChange={(e) => setForm({ ...form, defaultLimit: e.target.value })}
          />
        </div>
      </div>
      <HelpNotice>
        Connects with <span className="font-mono">mysql2/promise</span> (works with MySQL
        5.7+/8.x and MariaDB). Passwords go to your OS keychain; only read-only
        statements reach the server.
      </HelpNotice>
    </>
  );
}

function MssqlFields(props: SqlFieldsProps) {
  const { form, setForm } = props;
  return (
    <>
      <SqlConnectionFields
        {...props}
        engine="mssql"
        hostPlaceholder="127.0.0.1"
        databasePlaceholder="master"
        userPlaceholder="sa"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label">Instance name (optional)</label>
          <Input
            value={form.mssqlInstanceName}
            onChange={(e) => setForm({ ...form, mssqlInstanceName: e.target.value })}
            placeholder="SQLEXPRESS"
          />
        </div>
        <div>
          <label className="label">Query timeout (ms)</label>
          <Input
            value={form.queryTimeoutMs}
            onChange={(e) => setForm({ ...form, queryTimeoutMs: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2 flex items-end gap-4">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={form.mssqlEncrypt}
              onChange={(e) => setForm({ ...form, mssqlEncrypt: e.target.checked })}
              className="h-3 w-3 accent-primary"
            />
            Encrypt connection (TLS)
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={form.mssqlTrustServerCertificate}
              onChange={(e) =>
                setForm({ ...form, mssqlTrustServerCertificate: e.target.checked })
              }
              className="h-3 w-3 accent-primary"
            />
            Trust server certificate
          </label>
        </div>
        <div>
          <label className="label">Default TOP (N)</label>
          <Input
            value={form.defaultLimit}
            onChange={(e) => setForm({ ...form, defaultLimit: e.target.value })}
          />
        </div>
      </div>
      <HelpNotice>
        Connects via the <span className="font-mono">mssql</span> package (tedious driver).
        Leave <span className="font-medium">Trust server certificate</span> off for Azure
        SQL and managed instances; enable it for on-prem installs using a self-signed
        certificate. Named instances ignore the configured port and use the SQL Server
        Browser to resolve a dynamic port.
      </HelpNotice>
    </>
  );
}

function BigQueryFields({
  form,
  setForm,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
}) {
  return (
    <>
      <div>
        <label className="label">Google Cloud project ID</label>
        <Input
          value={form.projectId}
          onChange={(e) => setForm({ ...form, projectId: e.target.value })}
          placeholder="my-analytics-project"
        />
        <HelpNotice>
          Find it in the{' '}
          <ExternalAnchor href="https://console.cloud.google.com/">
            Google Cloud console
          </ExternalAnchor>
          . BigQuery bills the project that owns the query, which is often the same
          project that owns the datasets but doesn't have to be.
        </HelpNotice>
      </div>
      <div>
        <ServiceAccountPicker
          value={form.serviceAccountPath}
          onChange={(path) => setForm({ ...form, serviceAccountPath: path })}
          projectId={form.projectId}
          importCopy={form.importCopy}
          onImportChange={(next) => setForm({ ...form, importCopy: next })}
        />
        <HelpNotice>
          Leave blank to use{' '}
          <span className="font-medium">Application Default Credentials</span>{' '}
          (the <span className="font-mono">gcloud auth application-default login</span>{' '}
          session on this machine). Otherwise pick a service account with{' '}
          <span className="font-mono">BigQuery Data Viewer</span> +{' '}
          <span className="font-mono">BigQuery Job User</span> roles.
        </HelpNotice>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Default dataset</label>
          <Input
            value={form.bqDefaultDataset}
            onChange={(e) => setForm({ ...form, bqDefaultDataset: e.target.value })}
            placeholder="analytics_prod"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Optional. Scopes the Profiles → table list and sample picker to a single dataset.
          </p>
        </div>
        <div>
          <label className="label">Location</label>
          <Input
            value={form.bqLocation}
            onChange={(e) => setForm({ ...form, bqLocation: e.target.value })}
            placeholder="US · EU · us-central1"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            BigQuery billing location. Leave blank to let the client infer.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Query timeout (ms)</label>
          <Input
            value={form.queryTimeoutMs}
            onChange={(e) => setForm({ ...form, queryTimeoutMs: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Default row limit</label>
          <Input
            value={form.defaultLimit}
            onChange={(e) => setForm({ ...form, defaultLimit: e.target.value })}
          />
        </div>
      </div>
    </>
  );
}

function FileFields({
  form,
  setForm,
  editing,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  editing: Profile | null;
}) {
  async function pick() {
    const res = await ipc.dialog.pickDataFile();
    if (res.canceled) return;
    setForm({
      ...form,
      fileSourcePath: res.path,
      fileKind: res.kind,
      // Default the profile name to the filename when the user hasn't typed one.
      name: form.name.trim() ? form.name : basenameFor(res.path),
    });
  }
  const isEditing = !!editing && editing.engine === 'file';
  return (
    <>
      {isEditing ? (
        <HelpNotice>
          The file has already been imported into SQLite. You can rename this
          profile, change the env tag, or tweak the default limit — re-importing
          the file requires deleting this profile and creating a new one.
        </HelpNotice>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="label">Source file</label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={form.fileSourcePath}
                placeholder="Click Browse… to pick a CSV / XLSX"
                className="font-mono text-xs"
              />
              <Button type="button" onClick={pick}>
                Browse…
              </Button>
            </div>
            <HelpNotice>
              CSV becomes one SQLite table named after the filename. XLSX becomes
              one table per sheet. Columns are typed via a first-rows sample:
              <span className="font-mono"> INTEGER</span>,
              <span className="font-mono"> REAL</span>, or
              <span className="font-mono"> TEXT</span>.
            </HelpNotice>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Kind</label>
              <Select
                value={form.fileKind}
                onChange={(e) =>
                  setForm({ ...form, fileKind: e.target.value as 'csv' | 'xlsx' })
                }
              >
                <option value="csv">CSV / TSV</option>
                <option value="xlsx">Excel (XLSX)</option>
              </Select>
            </div>
            <div>
              <label className="label">Default row limit</label>
              <Input
                value={form.defaultLimit}
                onChange={(e) => setForm({ ...form, defaultLimit: e.target.value })}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function basenameFor(path: string): string {
  const segs = path.split(/[\\/]/);
  const last = segs[segs.length - 1] ?? path;
  return last.replace(/\.[^.]+$/, '');
}

/**
 * Prominent "Test connection" control: uses the default `btn` surface (border +
 * background + hover) so it reads as an action, not link text. Status appears
 * in `TestConnectionResultCard` below, not inline.
 */
function TestConnectionControl({
  test,
  disabled,
  onRun,
  hint,
}: {
  test: TestState;
  disabled: boolean;
  onRun: () => void;
  hint?: string;
}) {
  const running = test.status === 'running';
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 pr-1">
      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={onRun}
        disabled={disabled || running}
        title="Verify the saved profile can connect to the database"
        className="shrink-0 border-primary/25 shadow-soft hover:border-primary/40"
      >
        {running ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : (
          <Link2 size={14} aria-hidden />
        )}
        {running ? 'Testing…' : 'Test connection'}
      </Button>
      {test.status === 'idle' && hint ? (
        <span className="min-w-0 text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

/**
 * Full-width card under the footer action row. Shows in-progress, success, or
 * error results so long messages (e.g. server version) are not squeezed inline.
 */
function TestConnectionResultCard({ test, engine }: { test: TestState; engine: Engine }) {
  const toast = useToast();
  const [showTechnical, setShowTechnical] = useState(false);

  async function copyError() {
    if (test.status !== 'err') return;
    const text = `${test.code}: ${test.message}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.push('Error copied', 'info');
    } catch {
      toast.push('Could not copy error', 'error');
    }
  }

  if (test.status === 'idle') return null;
  if (test.status === 'running') {
    return (
      <div
        role="status"
        className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2.5 text-sm text-muted-foreground"
        aria-live="polite"
      >
        <Loader2 size={14} className="animate-spin shrink-0 text-primary" aria-hidden />
        <span>Checking connection to the server…</span>
      </div>
    );
  }
  if (test.status === 'ok') {
    return (
      <div
        role="status"
        className="flex w-full flex-col gap-1.5 rounded-md border border-env-dev/35 bg-env-dev/8 px-3 py-2.5 text-left text-sm"
        aria-live="polite"
      >
        <div className="flex items-center gap-1.5 font-medium text-env-dev">
          <CheckCircle2 size={16} className="shrink-0" aria-hidden />
          <span>Connection successful</span>
          <span className="ml-0.5 font-normal text-muted-foreground">· {test.elapsedMs}ms</span>
        </div>
        {test.detail ? (
          <p className="pl-[22px] text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {test.detail}
          </p>
        ) : null}
      </div>
    );
  }
  if (test.status !== 'err') return null;

  const explanation =
    engine === 'firestore'
      ? explainRunError(test.code, test.message)
      : null;

  return (
    <div
      role="alert"
      className="w-full overflow-hidden rounded-md border border-env-prod/30 bg-env-prod/5 text-sm"
    >
      <div className="flex w-full min-w-0 items-start gap-2 px-3 py-2.5">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-env-prod" aria-hidden />
        <div className="min-w-0 flex-1">
          {explanation ? (
            <>
              <p className="font-medium text-env-prod">{explanation.title}</p>
              <p className="mt-1 text-xs text-foreground/80 leading-relaxed">{explanation.body}</p>
              {explanation.hint ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  <span className="font-medium">Tip: </span>{explanation.hint}
                </p>
              ) : null}
              {explanation.showTechnical ? (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTechnical((v) => !v)}
                    className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
                  >
                    {showTechnical ? 'Hide technical details' : 'Show technical details'}
                  </button>
                  <button
                    type="button"
                    onClick={copyError}
                    className="inline-flex items-center gap-0.5 rounded text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Copy size={11} aria-hidden />
                    Copy
                  </button>
                </div>
              ) : null}
              {showTechnical ? (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-foreground/80 rounded border border-border bg-secondary/50 p-2 [overflow-wrap:anywhere]">
                  {explanation.technical}
                </pre>
              ) : null}
            </>
          ) : (
            <>
              <p className="font-medium text-env-prod">Connection failed</p>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-env-prod/95">
                <span className="font-mono text-[11px] text-env-prod">Code {test.code}</span>
                <button
                  type="button"
                  onClick={copyError}
                  className="inline-flex items-center gap-0.5 rounded text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Copy size={12} aria-hidden />
                  Copy error
                </button>
              </div>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-foreground/90 [overflow-wrap:anywhere]">
                {test.message}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HelpNotice({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 p-2 text-xs text-muted-foreground">
      <Info size={14} className="mt-0.5 flex-shrink-0 text-primary" />
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

/**
 * “Load” probe failures: same card language as `HelpNotice`, but for errors —
 * short title + plain-language body, optional technical block, and a next step.
 */
function ProbeErrorCard({ code, message }: { code: string; message: string }) {
  const ex = explainSqlProbeError(code, message);
  return (
    <div
      role="alert"
      className="mt-2 flex items-start gap-2.5 rounded-md border border-destructive/25 bg-destructive/[0.07] p-3 text-xs shadow-sm"
    >
      <AlertCircle
        size={16}
        className="mt-0.5 flex-shrink-0 text-destructive"
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium text-foreground">{ex.title}</p>
        <p className="leading-relaxed text-muted-foreground">{ex.body}</p>
        {ex.showTechnical ? (
          <details className="rounded border border-border/50 bg-background/40">
            <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
              Technical details
            </summary>
            <pre className="max-h-32 overflow-auto border-t border-border/50 px-2.5 py-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-foreground/90">
              {ex.technical}
            </pre>
          </details>
        ) : null}
        <p className="border-t border-destructive/10 pt-2 text-[11px] leading-relaxed text-muted-foreground">
          {ex.hint}
        </p>
      </div>
    </div>
  );
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline"
    >
      {children}
      <ExternalLink size={10} />
    </a>
  );
}

type ProbeStatus = 'idle' | 'loading' | 'ok' | 'err';

/**
 * Turn the current form state into a `SqlProbeDraft`. Returns `null`
 * when required inputs aren't present yet (the caller surfaces a hint
 * instead of firing a guaranteed-to-fail probe).
 */
function buildProbeDraft(
  form: FormState,
  engine: Exclude<SqlDialect, 'bigquery' | 'sqlite'>,
  editing: Profile | null,
): SqlProbeDraft | null {
  const host = form.sqlHost.trim();
  const user = form.sqlUser.trim();
  const port = Number(form.sqlPort);
  if (!host || !user || !Number.isFinite(port) || port <= 0) return null;
  // When editing and the password hasn't been touched, the main
  // process pulls it from the keychain — we don't need to send it.
  const isEditing =
    editing?.engine === 'postgres' ||
    editing?.engine === 'mysql' ||
    editing?.engine === 'mssql';
  const hasStored = isEditing ? editing.hasPassword : false;
  const password = form.sqlPassword.length > 0 ? form.sqlPassword : undefined;
  if (!password && !hasStored) return null;
  const draft: SqlProbeDraft = {
    engine,
    host,
    port,
    user,
    password,
    sslMode: form.sslMode,
  };
  if (engine === 'mssql') {
    draft.encrypt = form.mssqlEncrypt;
    draft.trustServerCertificate = form.mssqlTrustServerCertificate;
    if (form.mssqlInstanceName.trim().length > 0) {
      draft.instanceName = form.mssqlInstanceName.trim();
    }
  }
  return draft;
}

function probeRequestFor(
  form: FormState,
  engine: Exclude<SqlDialect, 'bigquery' | 'sqlite'>,
  editing: Profile | null,
): { profileId?: string; draft?: SqlProbeDraft } | null {
  const draft = buildProbeDraft(form, engine, editing);
  if (!draft) return null;
  const isEditing =
    editing?.engine === 'postgres' ||
    editing?.engine === 'mysql' ||
    editing?.engine === 'mssql';
  // Prefer profileId (+ draft overrides) when editing so the keychain
  // password is used when the field is empty.
  if (isEditing) return { profileId: editing.id, draft };
  return { draft };
}

/**
 * Editable input that can "load" its choices from the server and swap
 * to a dropdown. Users can always flip back to free text — the probe
 * is a convenience, not a constraint (least-privileged roles may not
 * have access to the catalog queries).
 */
function DatabaseCombobox({
  form,
  setForm,
  editing,
  engine,
  placeholder,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  editing: Profile | null;
  engine: Exclude<SqlDialect, 'bigquery' | 'sqlite'>;
  placeholder?: string;
}) {
  const [status, setStatus] = useState<ProbeStatus>('idle');
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [freeText, setFreeText] = useState(false);

  async function load() {
    const req = probeRequestFor(form, engine, editing);
    if (!req) {
      setStatus('err');
      setError({
        code: 'MISSING_INPUTS',
        message: 'Fill in host, port, user, and password first.',
      });
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const res = await ipc.db.probeSqlDatabases(req);
      if (res.ok) {
        setOptions(res.databases);
        setStatus('ok');
        // Preserve the typed value if it's in the list; otherwise leave
        // the field alone so the user doesn't lose their input.
        if (res.databases.length > 0 && !form.sqlDatabase) {
          setForm({ ...form, sqlDatabase: res.databases[0] });
        }
      } else {
        setStatus('err');
        setError({ code: res.code, message: res.message });
      }
    } catch (err) {
      setStatus('err');
      setError({
        code: 'PROBE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const showSelect = status === 'ok' && options.length > 0 && !freeText;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-stretch gap-2">
        {showSelect ? (
          <Select
            value={form.sqlDatabase}
            onChange={(e) => setForm({ ...form, sqlDatabase: e.target.value })}
          >
            {/* When the current value isn't in the list we still want
                to keep it visible (e.g. the user typed a name the
                server-side probe can't see due to permissions). */}
            {form.sqlDatabase && !options.includes(form.sqlDatabase) ? (
              <option value={form.sqlDatabase}>{form.sqlDatabase}</option>
            ) : null}
            {!form.sqlDatabase ? <option value="">(choose)</option> : null}
            {options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            value={form.sqlDatabase}
            onChange={(e) => setForm({ ...form, sqlDatabase: e.target.value })}
            placeholder={placeholder}
          />
        )}
        <ProbeActionButtons
          loading={status === 'loading'}
          showSelect={showSelect}
          onLoad={load}
          onFreeText={() => setFreeText(true)}
        />
      </div>
      {status === 'err' && error ? <ProbeErrorCard code={error.code} message={error.message} /> : null}
      {status === 'ok' && options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No databases returned by the server. Type one manually.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Schema equivalent of `DatabaseCombobox`. Only used by engines that
 * have a distinct schema layer (Postgres). Disabled until `sqlDatabase`
 * is set since schemas live inside a specific database.
 */
function SchemaCombobox({
  form,
  setForm,
  editing,
  engine,
  placeholder,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  editing: Profile | null;
  engine: Exclude<SqlDialect, 'bigquery' | 'sqlite'>;
  placeholder?: string;
}) {
  const [status, setStatus] = useState<ProbeStatus>('idle');
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [freeText, setFreeText] = useState(false);

  const database = form.sqlDatabase.trim();
  const disabled = database.length === 0;

  async function load() {
    const req = probeRequestFor(form, engine, editing);
    if (!req) {
      setStatus('err');
      setError({
        code: 'MISSING_INPUTS',
        message: 'Fill in host, port, user, and password first.',
      });
      return;
    }
    if (!database) {
      setStatus('err');
      setError({ code: 'MISSING_DATABASE', message: 'Pick a database first.' });
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const res = await ipc.db.probeSqlSchemas({ ...req, database });
      if (res.ok) {
        setOptions(res.schemas);
        setStatus('ok');
      } else {
        setStatus('err');
        setError({ code: res.code, message: res.message });
      }
    } catch (err) {
      setStatus('err');
      setError({
        code: 'PROBE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const showSelect = status === 'ok' && options.length > 0 && !freeText;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-stretch gap-2">
        {showSelect ? (
          <Select
            value={form.pgSchema}
            onChange={(e) => setForm({ ...form, pgSchema: e.target.value })}
          >
            {form.pgSchema && !options.includes(form.pgSchema) ? (
              <option value={form.pgSchema}>{form.pgSchema}</option>
            ) : null}
            {options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            value={form.pgSchema}
            onChange={(e) => setForm({ ...form, pgSchema: e.target.value })}
            placeholder={placeholder}
          />
        )}
        <ProbeActionButtons
          loading={status === 'loading'}
          showSelect={showSelect}
          onLoad={load}
          onFreeText={() => setFreeText(true)}
          disabled={disabled}
        />
      </div>
      {disabled ? (
        <p className="text-xs text-muted-foreground">Pick a database to discover schemas.</p>
      ) : null}
      {status === 'err' && error ? <ProbeErrorCard code={error.code} message={error.message} /> : null}
    </div>
  );
}

function ProbeActionButtons({
  loading,
  showSelect,
  onLoad,
  onFreeText,
  disabled = false,
}: {
  loading: boolean;
  showSelect: boolean;
  onLoad: () => void;
  onFreeText: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-stretch gap-1">
      <button
        type="button"
        onClick={onLoad}
        disabled={loading || disabled}
        className={cn(
          'inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground transition-colors',
          'hover:bg-accent hover:text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        title={disabled ? 'Fill in the required fields first' : 'Load options from the server'}
      >
        {loading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <RefreshCw size={12} />
        )}
        Load
      </button>
      {showSelect ? (
        <button
          type="button"
          onClick={onFreeText}
          className={cn(
            'inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground',
          )}
          title="Type a value manually"
        >
          <Pencil size={12} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Parses a Firebase Web config snippet (JSON object, or the JS object-literal
 * form copy-pasted from the Firebase console) and extracts `projectId` as a
 * partial Firestore profile. Handles both:
 *
 *   { "projectId": "my-proj", "apiKey": "…" }
 *
 * and the console-style:
 *
 *   const firebaseConfig = { projectId: "my-proj", … };
 *
 * Returns null when the input doesn't look like a Firebase config.
 */
export function parseFirebaseConfig(raw: string): Partial<FormState> | null {
  const trimmed = raw.trim();
  if (!/projectId/i.test(trimmed)) return null;

  // Isolate the {...} object literal if wrapped in assignment / export syntax.
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) return null;
  const inner = trimmed.slice(braceStart, braceEnd + 1);

  // Try strict JSON first, then fall back to a safer regex extraction of
  // just the projectId field to avoid eval-ing attacker-supplied input.
  let projectId: string | undefined;
  try {
    const parsed = JSON.parse(inner) as Record<string, unknown>;
    if (typeof parsed.projectId === 'string') projectId = parsed.projectId;
  } catch {
    const m = inner.match(/projectId\s*:\s*["']([^"']+)["']/);
    if (m) projectId = m[1];
  }
  if (!projectId) return null;

  return {
    engine: 'firestore',
    kind: 'live',
    projectId,
  };
}

/**
 * Parses a connection string (postgres://, mysql://, mssql://) into FormState
 * partial overrides. Returns null when the string can't be parsed.
 */
export function parseConnectionString(
  raw: string,
  current: FormState,
): Partial<FormState> | null {
  try {
    const url = new URL(raw.trim());
    const protocol = url.protocol.replace(':', '').toLowerCase();
    const engineMap: Record<string, Engine> = {
      postgres: 'postgres',
      postgresql: 'postgres',
      mysql: 'mysql',
      mariadb: 'mysql',
      mssql: 'mssql',
      sqlserver: 'mssql',
      'mssql+pyodbc': 'mssql',
    };
    const engine = engineMap[protocol];
    if (!engine) return null;

    const host = url.hostname || '127.0.0.1';
    const port = url.port || defaultPortFor(engine);
    const database = url.pathname.replace(/^\//, '').split('?')[0];
    const user = url.username ? decodeURIComponent(url.username) : '';
    const password = url.password ? decodeURIComponent(url.password) : '';

    return {
      engine,
      sqlHost: host,
      sqlPort: port,
      sqlDatabase: database,
      sqlUser: user,
      sqlPassword: password,
      sqlPasswordTouched: password.length > 0,
      pgSchema:
        engine === 'postgres'
          ? (url.searchParams.get('schema') ?? current.pgSchema)
          : current.pgSchema,
      sslMode:
        (url.searchParams.get('sslmode') as FormState['sslMode']) ?? current.sslMode,
    };
  } catch {
    return null;
  }
}

function QuickConnectInput({
  onParsed,
  disabled,
}: {
  onParsed: (overrides: Partial<FormState>) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [parsedAs, setParsedAs] = useState<'sql' | 'firebase' | null>(null);

  function handleChange(raw: string) {
    setValue(raw);
    setError('');
    setParsedAs(null);
    if (!raw.trim()) return;
    const sql = parseConnectionString(raw, emptyForm);
    if (sql) {
      onParsed(sql);
      setParsedAs('sql');
      return;
    }
    const firebase = parseFirebaseConfig(raw);
    if (firebase) {
      onParsed(firebase);
      setParsedAs('firebase');
      return;
    }
    if (raw.includes('://') || /projectId/i.test(raw)) {
      setError(
        'Could not parse. Supported: postgres://, mysql://, mssql://, or a Firebase Web config snippet.',
      );
    }
  }

  return (
    <div className="rounded-md border border-dashed border-border bg-secondary/30 p-3">
      <label className="label mb-1 flex items-center gap-1.5">
        <Link2 size={12} className="text-muted-foreground" />
        Quick Connect — paste a connection string or Firebase config
      </label>
      <Textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder='postgres://user:pass@host:5432/mydb  —or—  { "projectId": "my-proj", "apiKey": "…" }'
        rows={2}
        disabled={disabled}
        className="font-mono text-xs"
      />
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
      {!error && parsedAs && (
        <p className="mt-1 text-[11px] text-green-600 dark:text-green-400">
          {parsedAs === 'firebase'
            ? 'Parsed Firebase config — project ID filled in. Drop your service-account JSON below.'
            : 'Parsed connection string — fields below have been filled in.'}
        </p>
      )}
    </div>
  );
}
