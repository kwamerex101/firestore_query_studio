import { useCallback, useEffect, useState } from 'react';
import { Database, Play, RefreshCw } from 'lucide-react';
import type { RtdbProfile } from '@shared/types/profile';
import { ipc } from '../lib/ipcClient';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/utils';

type ReadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; json: string }
  | { status: 'err'; message: string };

/**
 * Read-only path probe for Firebase Realtime Database (Admin SDK). One-off
 * JSON fetch with server-side size limits — not a full tree browser.
 */
export function RtdbQueryPanel({ profile }: { profile: RtdbProfile }) {
  const toast = useToast();
  const [path, setPath] = useState('/');
  const [topKeys, setTopKeys] = useState<string[]>([]);
  const [read, setRead] = useState<ReadState>({ status: 'idle' });

  const reloadTopKeys = useCallback(async () => {
    try {
      const list = await ipc.collections.list();
      setTopKeys(list);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [toast]);

  useEffect(() => {
    void reloadTopKeys();
  }, [profile.id, reloadTopKeys]);

  async function onRead() {
    const p = path.trim() || '/';
    setRead({ status: 'loading' });
    try {
      const res = await ipc.rtdb.read({ path: p });
      if (!res.ok) {
        setRead({ status: 'err', message: `${res.code}: ${res.message}` });
        toast.push(res.message, 'error');
        return;
      }
      setRead({ status: 'ok', json: JSON.stringify(res.value, null, 2) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setRead({ status: 'err', message });
      toast.push(message, 'error');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4">
      <div className="rounded-md border border-border/80 bg-card/30 p-3 text-sm text-muted-foreground">
        <Database size={16} className="mr-1 inline-block text-primary align-[-2px]" />
        <span className="font-medium text-foreground">Realtime Database</span> — read a path
        as JSON. Large values are rejected server-side; prefer narrow paths. Listing top-level
        keys may fetch the full database root once.
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="rtdb-path">
            Path
          </label>
          <Input
            id="rtdb-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/users/alice or /"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void onRead();
              }
            }}
            className="font-mono text-sm"
          />
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="primary" onClick={() => void onRead()} className="gap-1.5">
            {read.status === 'loading' ? (
              'Reading…'
            ) : (
              <>
                <Play size={14} />
                Read
              </>
            )}
          </Button>
        </div>
      </div>
      <div className="grid gap-1 sm:grid-cols-[220px_1fr] sm:items-end">
        <div>
          <label className="label">Quick pick (top-level key)</label>
          <div className="flex gap-1">
            <Select
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) setPath(`/${v}`);
              }}
            >
              <option value="">(choose)</option>
              {topKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => void reloadTopKeys()}
              title="Reload top-level keys"
              aria-label="Reload top-level keys"
            >
              <RefreshCw size={12} className="transition-transform duration-300 hover:rotate-180" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Profile: <span className="font-mono text-foreground">{profile.projectId}</span>
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <label className="label">Result</label>
        <pre
          className={cn(
            'mt-1 max-h-[min(60vh,520px)] overflow-auto rounded-md border border-border bg-background/80 p-3 font-mono text-xs',
            read.status === 'err' && 'text-destructive',
          )}
        >
          {read.status === 'idle' ? (
            <span className="text-muted-foreground">Run a read to see JSON here.</span>
          ) : read.status === 'loading' ? (
            '…'
          ) : read.status === 'ok' ? (
            read.json
          ) : (
            read.message
          )}
        </pre>
      </div>
    </div>
  );
}
