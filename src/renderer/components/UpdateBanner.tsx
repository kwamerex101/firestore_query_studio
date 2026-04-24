import { useEffect, useState } from 'react';
import { ArrowUpCircle, X } from 'lucide-react';
import { Button } from './ui/button';
import { useToast } from './ui/toast';

interface FqsUpdaterApi {
  checkNow(): void;
  installNow(): void;
  onEvent(cb: (event: string, payload?: unknown) => void): () => void;
}

/**
 * Renders a dismissible banner when the main process reports that an
 * update has finished downloading. No-op on the web shell.
 *
 * Also listens for user-initiated checks (Help → Check for Updates) and
 * surfaces toast feedback so the command doesn't feel silent.
 */
export function UpdateBanner() {
  const toast = useToast();
  const [readyVersion, setReadyVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const updater = (window as unknown as { fqs?: { updater?: FqsUpdaterApi } }).fqs?.updater;
    if (!updater) return;

    const unsubscribe = updater.onEvent((event, payload) => {
      switch (event) {
        case 'updater:checking':
          toast.push('Checking for updates…', 'info');
          break;
        case 'updater:none':
          toast.push('You are on the latest version.', 'success');
          break;
        case 'updater:downloaded': {
          const v = (payload as { version?: string } | undefined)?.version;
          setReadyVersion(v ?? 'latest');
          setDismissed(false);
          break;
        }
        case 'updater:error': {
          const msg = (payload as { message?: string } | undefined)?.message;
          toast.push(`Update error: ${msg ?? 'unknown'}`, 'error');
          break;
        }
      }
    });

    // Hook the menu's "Check for Updates" command.
    const checkHandler = () => updater.checkNow();
    window.addEventListener('fqs:checkForUpdates', checkHandler);

    return () => {
      unsubscribe();
      window.removeEventListener('fqs:checkForUpdates', checkHandler);
    };
  }, [toast]);

  if (!readyVersion || dismissed) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary sm:px-4 animate-fade-in-down"
    >
      <ArrowUpCircle size={13} />
      <span>
        Version <span className="font-mono">{readyVersion}</span> is ready to install.
      </span>
      <Button
        size="sm"
        variant="primary"
        className="ml-auto h-6 px-2 text-[11px]"
        onClick={() => {
          const updater = (window as unknown as { fqs?: { updater?: FqsUpdaterApi } }).fqs?.updater;
          updater?.installNow();
        }}
      >
        Restart to update
      </Button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="rounded p-0.5 text-primary/70 transition-colors hover:bg-primary/15 hover:text-primary"
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}
