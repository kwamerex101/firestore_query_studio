import { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';

const DISMISSED_KEY = 'pwa-install-banner-dismissed';
const SHOW_AFTER_MS = 30_000;

export function PwaInstallBanner() {
  const { canInstall, installed, isIos, isInStandaloneMode, install } = usePwaInstall();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === '1',
  );

  useEffect(() => {
    if (dismissed || isInStandaloneMode || installed) return;
    if (!canInstall && !isIos) return;
    const timer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [canInstall, isIos, isInStandaloneMode, installed, dismissed]);

  function dismiss() {
    setVisible(false);
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, '1');
  }

  async function handleInstall() {
    await install();
    setVisible(false);
  }

  if (!visible || dismissed || isInStandaloneMode || installed) return null;

  return (
    <div
      role="banner"
      className="flex items-center gap-3 border-t border-primary/30 bg-primary/10 px-4 py-2.5 text-sm animate-fade-in-up"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
        <Download size={14} />
      </div>
      <div className="flex-1 min-w-0">
        {isIos ? (
          <p className="text-xs leading-relaxed text-foreground/80">
            <span className="font-medium">Install as an app:</span> tap{' '}
            <Share size={12} className="inline-block align-[-2px] mx-0.5" /> Share, then
            "Add to Home Screen".
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-foreground/80">
            <span className="font-medium">Install Firestore Query Studio</span> for faster
            access — works offline for navigation.
          </p>
        )}
      </div>
      {!isIos ? (
        <button
          type="button"
          onClick={handleInstall}
          className="shrink-0 rounded-md border border-primary/60 bg-primary/20 px-2.5 py-1 text-xs font-medium text-primary transition-all hover:bg-primary/30"
        >
          Install
        </button>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}
