import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, WifiOff } from 'lucide-react';
import { ipc } from '../lib/ipcClient';
import { cn } from '../lib/utils';

type Health =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; at: number; elapsedMs: number }
  | { status: 'err'; at: number; code: string; message: string };

const AUTO_PING_MS = 2 * 60 * 1_000;

/**
 * Compact connection-health chip rendered inside `EnvStrip`.
 *
 * - On mount and every 2 minutes, pings the active profile via
 *   `ipc.db.testConnection`.
 * - Click to force a retest (useful when credentials have just changed).
 * - Resets when `profileId` changes.
 */
export function ConnectionHealth({ profileId }: { profileId: string }) {
  const [health, setHealth] = useState<Health>({ status: 'idle' });

  const ping = useCallback(async () => {
    setHealth({ status: 'checking' });
    try {
      const res = await ipc.db.testConnection({ profileId });
      if (res.ok) {
        setHealth({ status: 'ok', at: Date.now(), elapsedMs: res.elapsedMs });
      } else {
        setHealth({
          status: 'err',
          at: Date.now(),
          code: res.code,
          message: res.message,
        });
      }
    } catch (err) {
      setHealth({
        status: 'err',
        at: Date.now(),
        code: 'IPC_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [profileId]);

  useEffect(() => {
    setHealth({ status: 'idle' });
    void ping();
    const handle = window.setInterval(() => void ping(), AUTO_PING_MS);
    return () => window.clearInterval(handle);
  }, [ping]);

  const { icon, label, tone, title } = renderState(health);

  return (
    <button
      type="button"
      onClick={() => void ping()}
      disabled={health.status === 'checking'}
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition-colors',
        tone,
        'hover:brightness-110 disabled:opacity-60',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function renderState(h: Health): {
  icon: React.ReactNode;
  label: string;
  tone: string;
  title: string;
} {
  switch (h.status) {
    case 'idle':
    case 'checking':
      return {
        icon: <Loader2 size={10} className="animate-spin" />,
        label: 'checking',
        tone: 'border-border/60 bg-secondary/40 text-muted-foreground',
        title: 'Checking connection…',
      };
    case 'ok':
      return {
        icon: <CheckCircle2 size={10} />,
        label: formatAgo(h.at),
        tone: 'border-env-dev/40 bg-env-dev/10 text-env-dev',
        title: `Connected · ${h.elapsedMs} ms · click to retest`,
      };
    case 'err':
      return {
        icon: <WifiOff size={10} />,
        label: 'offline',
        tone: 'border-env-prod/50 bg-env-prod/10 text-env-prod',
        title: `${h.code}: ${h.message} · click to retest`,
      };
  }
}

function formatAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1_000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
