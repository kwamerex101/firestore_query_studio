import { useState, type ReactNode } from 'react';
import { Plus, Trash2, Check, Edit2, Info, ExternalLink } from 'lucide-react';
import type { Profile, ProfileInput, ProfileKind, EnvTag } from '@shared/types/profile';
import { useAppState } from '../state/AppState';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Dialog } from '../components/ui/dialog';
import { EnvBadge } from '../components/ui/badge';
import { useToast } from '../components/ui/toast';
import { ipc } from '../lib/ipcClient';

type FormState = {
  name: string;
  kind: ProfileKind;
  envTag: EnvTag;
  projectId: string;
  serviceAccountPath: string;
  host: string;
  port: string;
  scanCap: string;
  sampleSize: string;
};

const emptyForm: FormState = {
  name: '',
  kind: 'emulator',
  envTag: 'dev',
  projectId: '',
  serviceAccountPath: '',
  host: '127.0.0.1',
  port: '8080',
  scanCap: '500',
  sampleSize: '10',
};

export function ProfilesPage() {
  const { profiles, activeProfile, reloadProfiles, setActiveProfile } = useAppState();
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(p: Profile) {
    setEditing(p);
    setForm({
      name: p.name,
      kind: p.kind,
      envTag: p.envTag,
      projectId: p.projectId,
      serviceAccountPath: p.kind === 'live' ? p.serviceAccountPath : '',
      host: p.kind === 'emulator' ? p.host : '127.0.0.1',
      port: p.kind === 'emulator' ? String(p.port) : '8080',
      scanCap: String(p.scanCap),
      sampleSize: String(p.sampleSize),
    });
    setDialogOpen(true);
  }

  async function save() {
    setBusy(true);
    try {
      const base = {
        name: form.name.trim(),
        envTag: form.envTag,
        projectId: form.projectId.trim(),
        scanCap: Number(form.scanCap),
        sampleSize: Number(form.sampleSize),
      };
      if (!base.name || !base.projectId) throw new Error('Name and Project ID are required.');
      if (editing) {
        if (editing.kind === 'live') {
          await ipc.profiles.update({
            id: editing.id,
            update: {
              ...base,
              serviceAccountPath: form.serviceAccountPath.trim(),
            },
          });
        } else {
          await ipc.profiles.update({
            id: editing.id,
            update: {
              ...base,
              host: form.host.trim(),
              port: Number(form.port),
            },
          });
        }
        toast.push('Profile updated', 'success');
      } else {
        const input: ProfileInput =
          form.kind === 'live'
            ? {
                kind: 'live',
                ...base,
                serviceAccountPath: form.serviceAccountPath.trim(),
              }
            : {
                kind: 'emulator',
                ...base,
                host: form.host.trim(),
                port: Number(form.port),
              };
        await ipc.profiles.create(input);
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
    if (!confirm(`Delete profile "${p.name}"? This only removes the profile; nothing on Firestore is touched.`)) {
      return;
    }
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

  return (
    <div className="h-full overflow-auto p-6 animate-fade-in">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Project profiles</h1>
          <p className="text-sm text-muted-foreground">
            Firestore projects you can connect to. Service-account JSON files are referenced by
            path only — nothing is copied into the app.
          </p>
        </div>
        <Button variant="primary" onClick={openNew}>
          <Plus size={14} />
          New profile
        </Button>
      </div>

      {profiles.length === 0 ? (
        <div className="card text-center text-sm text-muted-foreground animate-fade-in-up">
          No profiles yet. Add a Firestore Emulator or a live project to get started.
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
                    <Button size="icon" variant="ghost" onClick={() => openEdit(p)} title="Edit" aria-label="Edit">
                      <Edit2 size={14} />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(p)} title="Delete" aria-label="Delete">
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  <div>
                    <span className="font-mono">{p.projectId}</span>
                  </div>
                  <div className="truncate" title={p.kind === 'live' ? p.serviceAccountPath : undefined}>
                    {p.kind === 'live'
                      ? <>Live · <span className="font-mono">{p.serviceAccountPath}</span></>
                      : <>Emulator · <span className="font-mono">{p.host}:{p.port}</span></>}
                  </div>
                  <div>
                    scanCap <span className="font-mono">{p.scanCap}</span> · sampleSize <span className="font-mono">{p.sampleSize}</span>
                  </div>
                </div>
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
        description="Profiles are stored locally. Service-account JSON is referenced by path; LLM API keys live in your OS keychain."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <div>
            <label className="label">Name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Kind</label>
              <Select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as ProfileKind })}
                disabled={!!editing}
              >
                <option value="emulator">Emulator</option>
                <option value="live">Live (Admin SDK)</option>
              </Select>
            </div>
            <div>
              <label className="label">Environment</label>
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
              → select your project →{' '}
              <span className="font-medium">Project settings</span> (gear icon) →{' '}
              <span className="font-medium">General</span> tab → <span className="font-mono">Project ID</span>.
              For the emulator you can use any string; it just needs to match the one you use when starting the emulator.
            </HelpNotice>
          </div>
          {form.kind === 'live' ? (
            <div>
              <label className="label">Service-account JSON path</label>
              <Input
                value={form.serviceAccountPath}
                onChange={(e) => setForm({ ...form, serviceAccountPath: e.target.value })}
                placeholder="/absolute/path/to/service-account.json"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                The file stays where it is. We read it at connect time only.
              </p>
              <HelpNotice>
                Generate one in the{' '}
                <ExternalAnchor href="https://console.firebase.google.com/">
                  Firebase console
                </ExternalAnchor>{' '}
                → <span className="font-medium">Project settings</span> (gear icon) →{' '}
                <span className="font-medium">Service accounts</span> tab →{' '}
                <span className="font-medium">Generate new private key</span>. A JSON file downloads; save
                it somewhere safe and paste the absolute path above. Admin SDK credentials bypass
                Firestore security rules — prefer the Emulator or a dev project while you explore.
              </HelpNotice>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="label">Emulator host</label>
                <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
              </div>
              <div>
                <label className="label">Port</label>
                <Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Scan cap (max docs per scan)</label>
              <Input value={form.scanCap} onChange={(e) => setForm({ ...form, scanCap: e.target.value })} />
            </div>
            <div>
              <label className="label">Schema sample size</label>
              <Input value={form.sampleSize} onChange={(e) => setForm({ ...form, sampleSize: e.target.value })} />
            </div>
          </div>
        </div>
      </Dialog>
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
