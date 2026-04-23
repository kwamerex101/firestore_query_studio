import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCcw, Save, Terminal, XCircle } from 'lucide-react';
import type { CursorMode, CursorSettings } from '@shared/types/profile';
import type { CursorListModelsResult, CursorTestOutcome } from '@shared/types/ipc';
import { useAppState } from '../state/AppState';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useToast } from '../components/ui/toast';

const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_COMMAND = 'cursor-agent';
const DEFAULT_MODEL = 'auto';

function extraArgsToString(args: string[]): string {
  return args.join(', ');
}

function parseExtraArgs(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function envVarsToText(envVars: Record<string, string>): string {
  return Object.entries(envVars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function parseEnvVars(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = value;
  }
  return env;
}

export function CursorSettingsSection() {
  const {
    cursor,
    provider,
    saveCursor,
    reloadCursor,
    setProvider,
    listCursorModels,
    testCursor,
  } = useAppState();
  const toast = useToast();

  const [command, setCommand] = useState(DEFAULT_COMMAND);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [mode, setMode] = useState<CursorMode>('default');
  const [extraArgs, setExtraArgs] = useState('');
  const [cwd, setCwd] = useState('');
  const [envText, setEnvText] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(DEFAULT_TIMEOUT_SECONDS);

  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastTest, setLastTest] = useState<CursorTestOutcome | null>(null);

  const [models, setModels] = useState<CursorListModelsResult | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  const [useCursor, setUseCursor] = useState(provider === 'cursor-cli');

  useEffect(() => {
    setUseCursor(provider === 'cursor-cli');
  }, [provider]);

  useEffect(() => {
    setCommand(cursor?.command ?? DEFAULT_COMMAND);
    setModel(cursor?.model ?? DEFAULT_MODEL);
    setMode((cursor?.mode as CursorMode | undefined) ?? 'default');
    setExtraArgs(extraArgsToString(cursor?.extraArgs ?? []));
    setCwd(cursor?.cwd ?? '');
    setEnvText(envVarsToText(cursor?.envVars ?? {}));
    const ms = cursor?.timeoutMs ?? DEFAULT_TIMEOUT_SECONDS * 1000;
    setTimeoutSeconds(Math.round(ms / 1000));
  }, [cursor]);

  useEffect(() => {
    void refreshModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshModels() {
    setModelsLoading(true);
    try {
      const res = await listCursorModels();
      setModels(res);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setModelsLoading(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await saveCursor(buildPayloadFromForm());
      await reloadCursor();
      toast.push('Cursor settings saved', 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function buildPayloadFromForm(): CursorSettings {
    const clampedSeconds = Math.max(
      1,
      Math.min(600, Math.round(timeoutSeconds || DEFAULT_TIMEOUT_SECONDS)),
    );
    return {
      command: command.trim() || DEFAULT_COMMAND,
      model: model.trim() || DEFAULT_MODEL,
      mode,
      extraArgs: parseExtraArgs(extraArgs),
      cwd: cwd.trim() ? cwd.trim() : undefined,
      envVars: parseEnvVars(envText),
      timeoutMs: clampedSeconds * 1000,
    };
  }

  async function runTest() {
    setTesting(true);
    try {
      const res = await testCursor(buildPayloadFromForm());
      setLastTest(res);
      if (res.ok) {
        toast.push(
          res.version ? `Cursor CLI ready: ${res.version}` : 'Cursor CLI responded',
          'success',
        );
      } else {
        toast.push(`Cursor CLI test failed: ${res.message}`, 'error');
      }
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setTesting(false);
    }
  }

  async function onToggleProvider(enabled: boolean) {
    setUseCursor(enabled);
    try {
      await setProvider(enabled ? 'cursor-cli' : 'openai-compat');
      toast.push(
        enabled
          ? 'Cursor CLI is now the active planner backend.'
          : 'Reverted planner to OpenAI-compatible endpoint.',
        'success',
      );
    } catch (err) {
      setUseCursor(!enabled);
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  const modelOptions = useMemo(() => {
    const list = models?.models ?? [];
    if (list.some((m) => m.id === model) || !model) return list;
    return [{ id: model, label: `${model} (custom)` }, ...list];
  }, [models, model]);

  return (
    <div className="animate-fade-in">
      <div className="mb-1 flex items-center gap-2">
        <Terminal size={16} />
        <h2 className="text-lg font-semibold tracking-tight">Cursor Agent CLI</h2>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Use Cursor&apos;s Agent CLI for query planning instead of the OpenAI-compatible endpoint
        from the LLM section. Settings here are stored with Electron safeStorage.
      </p>

      <div className="mb-4 rounded-md border border-border bg-secondary/60 p-4 text-sm text-muted-foreground animate-fade-in-up">
        <div className="mb-2 font-medium text-foreground">Getting the CLI working</div>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            In a terminal, install:{' '}
            <code className="rounded bg-background/80 px-1 py-0.5 text-xs">
              curl https://cursor.com/install -fsSL | bash
            </code>
          </li>
          <li>
            Open a <strong>new</strong> terminal tab, then sign in:{' '}
            <code className="rounded bg-background/80 px-1 py-0.5 text-xs">cursor-agent login</code>{' '}
            (complete the flow in your browser).
          </li>
          <li>
            Confirm it runs:{' '}
            <code className="rounded bg-background/80 px-1 py-0.5 text-xs">cursor-agent --version</code>
            . If that fails, open a new shell or run{' '}
            <code className="rounded bg-background/80 px-1 py-0.5 text-xs">source ~/.zshrc</code>.
          </li>
          <li>
            Paste the full path from{' '}
            <code className="rounded bg-background/80 px-1 py-0.5 text-xs">which cursor-agent</code>{' '}
            into <strong>CLI command</strong> below. Electron often does not see the same{' '}
            <code>PATH</code> as your interactive shell, so a full path is the most reliable.
          </li>
          <li>
            Use <strong>Test</strong>, then <strong>Save</strong>, then enable &quot;Use Cursor CLI
            as the planner backend&quot;. After changing the install or preload, fully quit and
            restart the app (<code>pnpm dev</code>) if something still looks stuck.
          </li>
        </ol>
      </div>

      <div className="card mb-4 flex items-center justify-between gap-3 animate-fade-in-up">
        <div>
          <div className="text-sm font-medium">Use Cursor CLI as the planner backend</div>
          <div className="text-xs text-muted-foreground">
            When off, the OpenAI-compatible endpoint from the LLM section is used.
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={useCursor}
            onChange={(e) => void onToggleProvider(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-xs text-muted-foreground">
            Active: <strong>{provider === 'cursor-cli' ? 'Cursor CLI' : 'OpenAI-compatible'}</strong>
          </span>
        </label>
      </div>

      <div className="card grid gap-3 animate-fade-in-up">
        <div>
          <label className="label">CLI command</label>
          <div className="flex gap-2">
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="cursor-agent"
            />
            <Button
              variant="default"
              onClick={runTest}
              loading={testing}
              title="Run `<command> --version` to verify the CLI is installed."
            >
              {testing ? 'Testing…' : 'Test'}
            </Button>
          </div>
          {lastTest ? (
            <p
              className={
                'mt-1 flex items-center gap-1 text-xs ' +
                (lastTest.ok ? 'text-env-dev' : 'text-destructive')
              }
            >
              {lastTest.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              {lastTest.ok
                ? lastTest.version ?? 'CLI responded'
                : `${lastTest.code}: ${lastTest.message}`}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Prefer the full path from <code>which cursor-agent</code> if Test reports &quot;not
              found&quot;.
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="label">Model</label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshModels()}
              loading={modelsLoading}
              title="Run `<command> models` to discover installed models."
            >
              {!modelsLoading ? <RefreshCcw size={12} /> : null}
              Refresh
            </Button>
          </div>
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            {modelOptions.length === 0 ? (
              <option value={model || DEFAULT_MODEL}>{model || DEFAULT_MODEL}</option>
            ) : (
              modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))
            )}
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            {models?.source === 'cli'
              ? 'Models listed by the CLI.'
              : 'Could not list models from the CLI — showing a built-in fallback list.'}
            {models?.error ? ` (${models.error})` : ''}
          </p>
        </div>

        <div>
          <label className="label">Mode</label>
          <div className="flex gap-4 pt-1 text-sm">
            {(['default', 'plan', 'ask'] as const).map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="cursor-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                <span className="capitalize">{m}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            <code>plan</code> and <code>ask</code> map to the CLI <code>--mode</code> flag; leave
            as <code>default</code> for a normal autonomous run.
          </p>
        </div>

        <div>
          <label className="label">Extra args (comma-separated)</label>
          <Input
            value={extraArgs}
            onChange={(e) => setExtraArgs(e.target.value)}
            placeholder="--verbose, --max-steps, 3"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Passed to the CLI after the built-in flags. <code>--yolo</code> is auto-added if you
            don&apos;t provide <code>--yolo</code>/<code>--trust</code>/<code>-f</code>.
          </p>
        </div>

        <div>
          <label className="label">Default workspace (cwd)</label>
          <Input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="/absolute/path/to/workspace (optional)"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Passed as <code>--workspace</code> when set. Leave blank to run in the app&apos;s
            current working directory.
          </p>
        </div>

        <div>
          <label className="label">Environment variables</label>
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder={'CURSOR_API_KEY=sk-...\nFOO=bar'}
            className="input min-h-[88px] font-mono"
            rows={4}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            One <code>KEY=VALUE</code> per line. Stored in your OS keychain via Electron
            safeStorage. Lines starting with <code>#</code> are ignored.
          </p>
        </div>

        <div>
          <label className="label">Request timeout (seconds)</label>
          <Input
            type="number"
            min={5}
            max={600}
            value={timeoutSeconds}
            onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            The Cursor CLI can be slow on a cold start; 60s is a sane default.
          </p>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" onClick={save} loading={busy}>
            {!busy ? <Save size={14} /> : null}
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
