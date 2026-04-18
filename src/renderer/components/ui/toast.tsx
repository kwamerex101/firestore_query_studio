import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '../../lib/utils';

type ToastKind = 'info' | 'success' | 'error';
type ToastItem = { id: number; kind: ToastKind; message: string };

interface ToastContextValue {
  push(message: string, kind?: ToastKind): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const kindStyles: Record<ToastKind, { wrap: string; icon: ReactNode; bar: string }> = {
  info: {
    wrap: 'border-border bg-card/95 text-foreground',
    icon: <Info size={14} className="text-primary" aria-hidden />,
    bar: 'bg-primary',
  },
  success: {
    wrap: 'border-env-dev/50 bg-env-dev/10 text-foreground',
    icon: <CheckCircle2 size={14} className="text-env-dev" aria-hidden />,
    bar: 'bg-env-dev',
  },
  error: {
    wrap: 'border-destructive/60 bg-destructive/10 text-foreground',
    icon: <AlertTriangle size={14} className="text-destructive" aria-hidden />,
    bar: 'bg-destructive',
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((curr) => curr.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    setToasts((prev) => {
      const id = Date.now() + Math.random();
      const next: ToastItem = { id, kind, message };
      setTimeout(() => {
        setToasts((curr) => curr.filter((t) => t.id !== id));
      }, 4500);
      return [...prev, next];
    });
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => {
          const s = kindStyles[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                'group pointer-events-auto relative flex min-w-[260px] max-w-sm items-start gap-2 overflow-hidden rounded-lg border px-3 py-2 text-sm shadow-lift backdrop-blur-md animate-slide-in-right',
                s.wrap,
              )}
            >
              <span className="mt-0.5 flex-shrink-0">{s.icon}</span>
              <span className="flex-1 leading-snug">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="flex-shrink-0 rounded-md p-0.5 text-muted-foreground opacity-60 transition-opacity hover:bg-accent hover:opacity-100"
              >
                <X size={12} />
              </button>
              <span
                className={cn(
                  'absolute bottom-0 left-0 h-0.5 origin-left opacity-80',
                  s.bar,
                )}
                style={{
                  width: '100%',
                  animation: 'toast-progress 4.5s linear forwards',
                }}
              />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
