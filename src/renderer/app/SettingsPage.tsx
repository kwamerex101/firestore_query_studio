import { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { ChevronDown, Flame, HelpCircle, MessageSquare, Moon, Save, Server, Sparkles, Sun, Terminal } from 'lucide-react';
import { useAppState } from '../state/AppState';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { getSlackSettings, setSlackSettings } from '../lib/slackNotify';
import { useToast } from '../components/ui/toast';
import { ipc } from '../lib/ipcClient';
import { cn } from '../lib/utils';
import { CursorSettingsSection } from './CursorPage';
import { ClaudeSettingsSection } from './ClaudePage';

const DEFAULT_TIMEOUT_SECONDS = 30;

type SettingsSection = 'llm' | 'cursor' | 'claude' | 'slack' | 'faq';

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: React.ReactNode }> = [
  { id: 'llm', label: 'LLM', icon: <Server size={14} /> },
  { id: 'cursor', label: 'Cursor CLI', icon: <Terminal size={14} /> },
  { id: 'claude', label: 'Claude CLI', icon: <Sparkles size={14} /> },
  { id: 'slack', label: 'Slack', icon: <MessageSquare size={14} /> },
  { id: 'faq', label: 'FAQ', icon: <HelpCircle size={14} /> },
];

export function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>('llm');
  const { theme, setTheme } = useAppState();

  const THEME_OPTIONS: Array<{ value: typeof theme; label: string; icon: React.ReactNode }> = [
    { value: 'light', label: 'Light', icon: <Sun size={13} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
    { value: 'system', label: 'System', icon: <span className="text-[11px]">Auto</span> },
  ];

  return (
    <div className="h-full overflow-auto p-6 animate-fade-in">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Configure how Firestore Query Studio plans queries. Pick the OpenAI-compatible HTTP
          endpoint, or the Cursor Agent CLI.
        </p>

        {/* Theme picker */}
        <div className="mb-5 flex items-center justify-between rounded-lg border border-border bg-card/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Appearance</p>
            <p className="text-xs text-muted-foreground">Choose a color theme for the app.</p>
          </div>
          <div className="flex items-center rounded-md border border-border bg-secondary/50 p-0.5">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                className={cn(
                  'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-all duration-150',
                  theme === opt.value
                    ? 'bg-card text-foreground shadow-soft'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={theme === opt.value}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <SettingsSubNav active={section} onChange={setSection} />

        <div className="mt-5">
          {section === 'llm' ? (
            <LlmSettingsSection />
          ) : section === 'cursor' ? (
            <CursorSettingsSection />
          ) : section === 'claude' ? (
            <ClaudeSettingsSection />
          ) : section === 'slack' ? (
            <SlackSettingsSection />
          ) : (
            <FaqSection />
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsSubNav({
  active,
  onChange,
}: {
  active: SettingsSection;
  onChange: (s: SettingsSection) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLButtonElement>(`[data-settings-section="${active}"]`);
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    setIndicator({ left: rect.left - containerRect.left, width: rect.width });
  }, [active]);

  return (
    <nav
      ref={containerRef}
      className="relative inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-secondary/40 p-0.5"
      role="tablist"
      aria-label="Settings sections"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-[5px] bg-primary/20 shadow-soft transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]"
        style={{
          transform: `translateX(${indicator.left}px)`,
          width: indicator.width ? `${indicator.width}px` : 0,
          opacity: indicator.width ? 1 : 0,
        }}
      />
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          data-settings-section={s.id}
          role="tab"
          aria-selected={active === s.id}
          onClick={() => onChange(s.id)}
          className={cn(
            'relative z-10 flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors duration-200',
            active === s.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {s.icon}
          {s.label}
        </button>
      ))}
    </nav>
  );
}

function LlmSettingsSection() {
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
    <div className="animate-fade-in">
      <div className="mb-1 flex items-center gap-2">
        <Server size={16} />
        <h2 className="text-lg font-semibold tracking-tight">LLM (OpenAI-compatible)</h2>
      </div>
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
              <span className="font-semibold">Cursor CLI</span> section.
            </>
          ) : (
            <>
              Planner backend: <span className="font-semibold">OpenAI-compatible</span> (these
              settings). To use Cursor models instead, open the{' '}
              <span className="font-semibold">Cursor CLI</span> section.
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
        Admin SDK bypasses security rules; prefer the Emulator or a dev project while you&apos;re
        exploring.
      </div>
    </div>
  );
}

type FaqItem = { q: string; a: React.ReactNode };

const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'What is Firestore Query Studio?',
    a: (
      <>
        A local-first tool that turns natural-language questions into read-only Firestore
        queries. An LLM planner translates your prompt into a structured query plan, which
        the executor runs against Firestore and renders as a virtualized table.
      </>
    ),
  },
  {
    q: 'Is it really read-only?',
    a: (
      <>
        Yes. The executor and IPC surface do not expose any write, update, or delete paths.
        The planner is also constrained to read operations. Still, the Admin SDK bypasses
        security rules, so prefer the Firestore Emulator or a dev project while exploring.
      </>
    ),
  },
  {
    q: 'Where are my API keys and service accounts stored?',
    a: (
      <>
        In the desktop app, secrets are encrypted with Electron <code>safeStorage</code> (OS
        keychain / DPAPI / libsecret where available) and stored under your user data
        directory. In the web build, sensitive values stay in the browser and never leave
        your machine unless you configure a remote endpoint yourself.
      </>
    ),
  },
  {
    q: 'Which LLM providers are supported?',
    a: (
      <>
        Any OpenAI-compatible <code>/chat/completions</code> endpoint works — OpenAI,
        Ollama, LM Studio, vLLM, and most self-hosted gateways. You can also switch the
        planner backend to the Cursor Agent CLI under the <strong>Cursor CLI</strong> tab.
      </>
    ),
  },
  {
    q: 'Why is my local model slow on the first query?',
    a: (
      <>
        Local runtimes (Ollama, LM Studio) load weights on the first request. Click
        <strong> Warm up model</strong> after saving your settings to preload it, and keep
        the request timeout at 120–300s for local endpoints.
      </>
    ),
  },
  {
    q: 'How do I reset or delete my data?',
    a: (
      <>
        Clear connection profiles from the <strong>Profiles</strong> page and remove any
        stored API key by saving a blank value in <strong>LLM</strong>. To wipe everything,
        quit the app and delete its user-data directory (shown in the About/Help menu on
        desktop). The web build stores state in IndexedDB — clear it from your browser.
      </>
    ),
  },
  {
    q: 'Does it work offline?',
    a: (
      <>
        The UI and query history work offline. Firestore itself requires network access,
        and remote LLM providers do too. A local model (e.g., Ollama) plus the Firestore
        Emulator gives you a fully offline setup.
      </>
    ),
  },
  {
    q: 'I got a planner error — what should I try?',
    a: (
      <>
        Check that the <strong>Base URL</strong>, <strong>Model</strong>, and{' '}
        <strong>API key</strong> are correct, then click <strong>Warm up model</strong>. If
        the model returns malformed JSON, try a stronger model (e.g., <code>gpt-4o-mini</code>
        {' '}or a 7B+ instruct model locally). Increase the timeout for slow endpoints.
      </>
    ),
  },
];

function FaqSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div className="animate-fade-in">
      <div className="mb-1 flex items-center gap-2">
        <HelpCircle size={16} />
        <h2 className="text-lg font-semibold tracking-tight">Frequently asked questions</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Quick answers about how Firestore Query Studio works, where your data lives, and
        how to troubleshoot the planner.
      </p>

      <div className="divide-y divide-border/60 rounded-md border border-border/60 bg-secondary/30 animate-fade-in-up">
        {FAQ_ITEMS.map((item, idx) => {
          const open = openIdx === idx;
          return (
            <div key={item.q}>
              <button
                type="button"
                onClick={() => setOpenIdx(open ? null : idx)}
                aria-expanded={open}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-medium transition-colors',
                  'hover:bg-secondary/60 focus-visible:outline-none focus-visible:bg-secondary/60',
                )}
              >
                <span className="flex-1">{item.q}</span>
                <ChevronDown
                  size={14}
                  className={cn(
                    'shrink-0 text-muted-foreground transition-transform duration-200',
                    open ? 'rotate-180' : 'rotate-0',
                  )}
                />
              </button>
              {open ? (
                <div className="px-3 pb-3 text-sm text-muted-foreground animate-fade-in">
                  {item.a}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlackSettingsSection() {
  const initial = getSlackSettings();
  const [webhookUrl, setWebhookUrl] = useState(initial.webhookUrl);
  const [thresholdSeconds, setThresholdSeconds] = useState(
    String(Math.round(initial.thresholdMs / 1000)),
  );
  const [saved, setSaved] = useState(false);

  function save() {
    const ms = Math.max(1, Number(thresholdSeconds) || 10) * 1000;
    setSlackSettings({ webhookUrl: webhookUrl.trim(), thresholdMs: ms });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-4 animate-fade-in">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Slack notifications</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Post a message to a Slack Incoming Webhook when a query takes longer than
          your threshold. Useful for long-running exports you walk away from.
        </p>
      </div>

      <div>
        <label className="label">Webhook URL</label>
        <Input
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/T.../B.../..."
          type="password"
          spellCheck={false}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Create one at{' '}
          <a
            href="https://api.slack.com/messaging/webhooks"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            api.slack.com/messaging/webhooks
          </a>
          . Stored in this browser's localStorage — not synced to the desktop keychain.
        </p>
      </div>

      <div>
        <label className="label">Notify when a query takes longer than</label>
        <div className="flex items-center gap-2">
          <Input
            value={thresholdSeconds}
            onChange={(e) => setThresholdSeconds(e.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            className="max-w-[100px]"
          />
          <span className="text-xs text-muted-foreground">seconds</span>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" onClick={save}>
          <Save size={14} />
          {saved ? 'Saved!' : 'Save'}
        </Button>
        {webhookUrl && (
          <Button
            variant="ghost"
            onClick={() => {
              setWebhookUrl('');
              setSlackSettings({ webhookUrl: '', thresholdMs: Number(thresholdSeconds) * 1000 });
            }}
          >
            Clear webhook
          </Button>
        )}
      </div>
    </div>
  );
}
