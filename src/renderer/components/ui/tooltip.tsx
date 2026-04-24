import { useId, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Lightweight tooltip — pure CSS-positioned, no external libs.
 * Shows on hover (desktop) and on keyboard focus (a11y). The content is
 * rendered inside a `role="tooltip"` node referenced by `aria-describedby`
 * on the trigger so screen readers announce it.
 *
 * Wrap any element:
 *
 *   <Tooltip content="Max docs scanned per run">
 *     <button>Scan Cap</button>
 *   </Tooltip>
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);

  const placement = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side];

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} className="contents">
        {children}
      </span>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-50 whitespace-normal rounded-md border border-border bg-popover px-2 py-1 text-[11px] leading-snug text-popover-foreground shadow-lg animate-fade-in',
            'max-w-[220px]',
            placement,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

/**
 * An unobtrusive "?" badge that triggers a tooltip. Useful for labeling
 * form fields without stealing horizontal space.
 *
 *   <label>Scan Cap <InfoTip content="Max docs per run" /></label>
 */
export function InfoTip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <span
        tabIndex={0}
        aria-label="More info"
        className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-border/60 bg-muted/40 text-[9px] font-bold text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        ?
      </span>
    </Tooltip>
  );
}
