import { useState, useEffect } from 'react';
import { Flame, Save, Terminal } from 'lucide-react';
import { useAppState } from '../state/AppState';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import { ipc } from '../lib/ipcClient';

const DEFAULT_TIMEOUT_SECONDS = 30;

export function SettingsPage() {
  const { llm, saveLlm, provider } = useAppState();
  const toast = useToast();
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(DEFAULT_TIMEOUT_SECONDS);
  const [busy, setBusy] = useState(false);
  const [warming, setWarming] = useState(false);

  useEffect(() => {
    setBaseUrl(llm?.baseUrl ?? '');
    setModel(llm?.model ?? '');
    setApiKey('');
    const ms = llm?.timeoutMs ?? DEFAULT_TIMEOUT_SECONDS * 1000;
    setTimeoutSeconds(Math.round(ms / 1000));
  }, [llm]);

  const looksLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(baseUrl);

  async function save() {
    setBusy(true);
    try {
      const clampedSeconds = Math.max(5, Math.min(600, Math.round(timeoutSeconds || DEFAULT_TIMEOUT_SECONDS)));
      await saveLlm({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
        timeoutMs: clampedSeconds * 1000,
      });
      toast.push('LLM settings saved', 'success');
      if (looksLocal) {
        void warmup({ silent: true });
      }
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function warmup(opts: { silent?: boolean } = {}): Promise<void> {
    setWarming(true);
    try {
      const res = await ipc.llm.warmup();
      if (res.ok) {
        toast.push(`Model warmed up in ${(res.elapsedMs / 1000).toFixed(1)}s`, 'success');
      } else if (!opts.silent) {
        toast.push(`Warmup failed: ${res.code} — ${res.message}`, 'error');
      }
    } catch (err) {
      if (!opts.silent) {
        toast.push(err instanceof Error ? err.message : String(err), 'error');
      }
    } finally {
      setWarming(false);
    }
  }

  return (
    <div className="h-full overflow-auto p-6 animate-fade-in">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-lg font-semibold tracking-tight">LLM settings</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Bring your own key and your own base URL. Any OpenAI-compatible endpoint works
          (OpenAI, Ollama, LM Studio, self-hosted). Values are stored in your OS keychain via
          Electron safeStorage.
        </p>

        <div
          className={
            'mb-4 flex items-start gap-2 rounded-md border p-3 text-xs animate-fade-in-up ' +
            (provider === 'cursor-cli'
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
              : 'border-primary/30 bg-primary/10 text-primary')
          }
        >
          <Terminal size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            {provider === 'cursor-cli' ? (
              <>
                Planner backend: <span className="font-semibold">Cursor CLI</span>. The settings
                below are not used until you switch back. Manage the active provider in the{' '}
                <span className="font-semibold">Cursor</span> tab.
              </>
            ) : (
              <>
                Planner backend: <span className="font-semibold">OpenAI-compatible</span> (these
                settings). To use Cursor models instead, open the{' '}
                <span className="font-semibold">Cursor</span> tab.
              </>
            )}
          </div>
        </div>

        <div className="card grid gap-3 animate-fade-in-up">
          <div>
            <label className="label">Base URL</label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              The <code>/chat/completions</code> path is appended automatically.
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
            <label className="label">API key</label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={llm?.hasApiKey ? '•••••••• (leave blank to keep existing)' : 'sk-...'}
            />
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
              {looksLocal
                ? 'Local models can be slow on cold start. 120–300s is typical for Ollama/LM Studio.'
                : 'Cloud APIs usually respond in under 5s. 30s is a safe default.'}
              {' '}Retries are disabled automatically when the timeout is 60s or more.
            </p>
          </div>
          <div className="flex justify-between gap-2">
            <Button
              variant="default"
              onClick={() => warmup()}
              disabled={!llm?.hasApiKey}
              loading={warming}
              title={!llm?.hasApiKey ? 'Save an API key first' : 'Send a tiny ping to load the model into memory'}
            >
              {!warming ? <Flame size={14} /> : null}
              {warming ? 'Warming…' : 'Warm up model'}
            </Button>
            <Button variant="primary" onClick={save} loading={busy}>
              {!busy ? <Save size={14} /> : null}
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="mt-6 rounded-md border border-border bg-secondary/60 p-3 text-xs text-muted-foreground animate-fade-in-up">
          Phase 1 is strictly read-only. No write paths exist in the executor or IPC surface.
          Admin SDK bypasses security rules; prefer the Emulator or a dev project while you're
          exploring.
        </div>
      </div>
    </div>
  );
}
