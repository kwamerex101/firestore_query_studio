import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCcw, Save, Sparkles, XCircle } from 'lucide-react';
import type {
  ClaudePermissionMode,
  ClaudeSettings,
} from '@shared/types/profile';
import type {
  ClaudeListModelsResult,
  ClaudeTestOutcome,
} from '@shared/types/ipc';
import { useAppState } from '../state/AppState';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useToast } from '../components/ui/toast';

const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_COMMAND = 'claude';
const DEFAULT_MODEL = 'sonnet';

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

export function ClaudeSettingsSection() {
  const {
    claude,
    provider,
    saveClaude,
    reloadClaude,
    setProvider,
    listClaudeModels,
    testClaude,
  } = useAppState();
  const toast = useToast();

  const [command, setCommand] = useState(DEFAULT_COMMAND);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [permissionMode, setPermissionMode] =
    useState<ClaudePermissionMode>('default');
  const [extraArgs, setExtraArgs] = useState('');
  const [cwd, setCwd] = useState('');
  const [envText, setEnvText] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] =
    useState<number>(DEFAULT_TIMEOUT_SECONDS);

  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastTest, setLastTest] = useState<ClaudeTestOutcome | null>(null);

  const [models, setModels] = useState<ClaudeListModelsResult | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  const [useClaude, setUseClaude] = useState(provider === 'claude-cli');

  useEffect(() => {
    setUseClaude(provider === 'claude-cli');
  }, [provider]);

  useEffect(() => {
    setCommand(claude?.command ?? DEFAULT_COMMAND);
    setModel(claude?.model ?? DEFAULT_MODEL);
    setPermissionMode(
      (claude?.permissionMode as ClaudePermissionMode | undefined) ?? 'default',
    );
    setExtraArgs(extraArgsToString(claude?.extraArgs ?? []));
    setCwd(claude?.cwd ?? '');
    setEnvText(envVarsToText(claude?.envVars ?? {}));
    const ms = claude?.timeoutMs ?? DEFAULT_TIMEOUT_SECONDS * 1000;
    setTimeoutSeconds(Math.round(ms / 1000));
  }, [claude]);

  useEffect(() => {
    void refreshModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshModels() {
    setModelsLoading(true);
    try {
      const res = await listClaudeModels();
      setModels(res);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setModelsLoading(false);
    }
  }

  function buildPayloadFromForm(): ClaudeSettings {
    const clampedSeconds = Math.max(
      1,
      Math.min(600, Math.round(timeoutSeconds || DEFAULT_TIMEOUT_SECONDS)),
    );
    return {
      command: command.trim() || DEFAULT_COMMAND,
      model: model.trim() || DEFAULT_MODEL,
      permissionMode,
      extraArgs: parseExtraArgs(extraArgs),
      cwd: cwd.trim() ? cwd.trim() : undefined,
      envVars: parseEnvVars(envText),
      timeoutMs: clampedSeconds * 1000,
    };
  }

  async function save() {
    setBusy(true);
    try {
      await saveClaude(buildPayloadFromForm());
      await reloadClaude();
      toast.push('Claude settings saved', 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTesting(true);
    try {
      const res = await testClaude(buildPayloadFromForm());
      setLastTest(res);
      if (res.ok) {
        toast.push(
          res.version ? `Claude CLI ready: ${res.version}` : 'Claude CLI responded',
          'success',
        );
      } else {
        toast.push(`Claude CLI test failed: ${res.message}`, 'error');
      }
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setTesting(false);
    }
  }

  async function onToggleProvider(enabled: boolean) {
    setUseClaude(enabled);
    try {
      await setProvider(enabled ? 'claude-cli' : 'openai-compat');
      toast.push(
        enabled
          ? 'Claude CLI is now the active planner backend.'
          : 'Reverted planner to OpenAI-compatible endpoint.',
        'success',
      );
    } catch (err) {
      setUseClaude(!enabled);
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
        <Sparkles size={16} />
        <h2 className="text-lg font-semibold tracking-tight">Claude CLI</h2>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Use Anthropic&apos;s Claude CLI for query planning instead of the OpenAI-compatible
        endpoint. Settings are stored with Electron safeStorage. Desktop-only.
      </p>

      <div className="mb-4 rounded-md border border-border bg-secondary/60 p-4 text-sm text-muted-foreground animate-fade-in-up">
        <div className="mb-2 font-medium text-foreground">Getting the CLI working</div>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Install the CLI globally:{' '}
            <code className="rounded bg-background/80 px-1 py-0.5 text-xs">
              npm i -g @anthropic-ai/claude-code
            </code>
          </li>
          <li>
            Open a <strong>new</strong> terminal tab, then authenticate:{' '}
            <code className="rounded bg-background/80 px-1 py-0.5 text-xs">claude</code>{' '}
            (interactive) and complete the browser flow, or export{' '}
            <code className="rounded bg-background/80 px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code>{' '}
            for headless use.
          </li>
          <li>
            Confirm it runs:{' '}
            <code className="rounded bg-background/80 px-1 py-0.5 text-xs">claude --version</code>
            . If that fails, open a new shell or source your rc file.
          </li>
          <li>
            Paste the full path from{' '}
            <code className="rounded bg-background/80 px-1 py-0.5 text-xs">which claude</code>{' '}
            into <strong>CLI command</strong> below. Electron&apos;s <code>PATH</code> often
            differs from your interactive shell, so an absolute path is the most reliable.
          </li>
          <li>
            Use <strong>Test</strong>, then <strong>Save</strong>, then enable &quot;Use Claude
            CLI as the planner backend&quot;.
          </li>
        </ol>
      </div>

      <div className="card mb-4 flex items-center justify-between gap-3 animate-fade-in-up">
        <div>
          <div className="text-sm font-medium">Use Claude CLI as the planner backend</div>
          <div className="text-xs text-muted-foreground">
            When off, the OpenAI-compatible endpoint from the LLM section is used.
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={useClaude}
            onChange={(e) => void onToggleProvider(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-xs text-muted-foreground">
            Active:{' '}
            <strong>
              {provider === 'claude-cli'
                ? 'Claude CLI'
                : provider === 'cursor-cli'
                  ? 'Cursor CLI'
                  : 'OpenAI-compatible'}
            </strong>
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
              placeholder="claude"
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
              Prefer the full path from <code>which claude</code> if Test reports &quot;not
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
              title="Refresh the model list."
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
            Aliases (<code>sonnet</code>, <code>opus</code>, <code>haiku</code>) resolve to the
            CLI&apos;s default for each family. Paste a full model id (e.g.{' '}
            <code>claude-sonnet-4-6</code>) to pin a specific snapshot.
          </p>
        </div>

        <div>
          <label className="label">Permission mode</label>
          <Select
            value={permissionMode}
            onChange={(e) =>
              setPermissionMode(e.target.value as ClaudePermissionMode)
            }
          >
            <option value="default">default</option>
            <option value="plan">plan</option>
            <option value="acceptEdits">acceptEdits</option>
            <option value="bypassPermissions">bypassPermissions</option>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            Planner calls only read the text response, so <code>default</code> works fine.{' '}
            <code>plan</code> forces Claude into a read-only planning mode.
          </p>
        </div>

        <div>
          <label className="label">Extra args (comma-separated)</label>
          <Input
            value={extraArgs}
            onChange={(e) => setExtraArgs(e.target.value)}
            placeholder="--verbose, --max-turns, 1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Appended after the built-in <code>-p --output-format json</code> flags. Useful for
            passing <code>--allowedTools</code> or other CLI options.
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
            Sets the spawned process&apos;s working directory. Leave blank to inherit the
            app&apos;s cwd.
          </p>
        </div>

        <div>
          <label className="label">Environment variables</label>
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder={'ANTHROPIC_API_KEY=sk-ant-...\nFOO=bar'}
            className="input min-h-[88px] font-mono"
            rows={4}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            One <code>KEY=VALUE</code> per line. Stored in the OS keychain via Electron
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
            Cold starts can take a few seconds; 60s is a safe default.
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
