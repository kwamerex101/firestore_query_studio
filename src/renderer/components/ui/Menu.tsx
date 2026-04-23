import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Small, dependency-free dropdown menu. Avoids pulling in a full
 * headless library — we just need click-outside, ESC, and simple
 * keyboard navigation over menu items.
 *
 * Usage:
 *
 *   <Menu>
 *     <MenuTrigger icon={Eye}>View</MenuTrigger>
 *     <MenuContent>
 *       <MenuItem selected onSelect={...}>Table</MenuItem>
 *       <MenuItem onSelect={...}>JSON</MenuItem>
 *     </MenuContent>
 *   </Menu>
 */

interface MenuContextValue {
  open: boolean;
  setOpen: (next: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  contentId: string;
  align: 'start' | 'end';
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext(source: string): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) {
    throw new Error(`${source} must be rendered inside a <Menu>`);
  }
  return ctx;
}

export function Menu({
  children,
  align = 'end',
}: {
  children: ReactNode;
  /** Horizontal alignment of the popover relative to the trigger. */
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentId = useId();
  const value = useMemo<MenuContextValue>(
    () => ({ open, setOpen, triggerRef, contentId, align }),
    [open, contentId, align],
  );
  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

interface MenuTriggerProps {
  icon?: LucideIcon;
  children: ReactNode;
  title?: string;
  className?: string;
  active?: boolean;
}

export function MenuTrigger({
  icon: Icon,
  children,
  title,
  className,
  active,
}: MenuTriggerProps) {
  const { open, setOpen, triggerRef, contentId } = useMenuContext('MenuTrigger');
  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => setOpen(!open)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={contentId}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-secondary/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground',
        (open || active) && 'border-primary/50 bg-primary/10 text-primary',
        className,
      )}
    >
      {Icon ? <Icon size={12} /> : null}
      {children}
      <svg
        aria-hidden
        width="9"
        height="9"
        viewBox="0 0 9 9"
        className={cn(
          'transition-transform duration-200',
          open && 'rotate-180',
        )}
      >
        <path
          d="M1.5 3L4.5 6L7.5 3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function MenuContent({
  children,
  className,
  minWidth = 160,
}: {
  children: ReactNode;
  className?: string;
  minWidth?: number;
}) {
  const { open, setOpen, triggerRef, contentId, align } =
    useMenuContext('MenuContent');
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );

  const updatePosition = useCallback(() => {
    if (!open) return;
    const btn = triggerRef.current;
    const content = contentRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const measuredW = content?.getBoundingClientRect().width;
    const contentWidth =
      measuredW && measuredW > 0
        ? measuredW
        : Math.max(minWidth, Math.ceil(rect.width));
    let top = rect.bottom + 4;
    const left = align === 'end' ? rect.right - contentWidth : rect.left;
    const padding = 8;
    const clampedLeft = Math.max(
      padding,
      Math.min(left, window.innerWidth - contentWidth - padding),
    );
    // Prefer below the trigger; if the menu would extend past the viewport, open upward.
    const h = content?.getBoundingClientRect().height ?? 0;
    if (h > 0) {
      if (top + h > window.innerHeight - padding) {
        const up = rect.top - h - 4;
        if (up >= padding) {
          top = up;
        }
      }
    }
    top = Math.max(padding, top);
    setCoords({ top, left: clampedLeft });
  }, [align, minWidth, open, triggerRef]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updatePosition();
    // Re-measure after the portaled menu is painted (real width/height).
    const raf = requestAnimationFrame(() => updatePosition());
    return () => cancelAnimationFrame(raf);
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (contentRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen, triggerRef]);

  // Simple keyboard focus management: focus first item on open.
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      const first = contentRef.current?.querySelector<HTMLButtonElement>(
        '[data-menu-item]:not([disabled])',
      );
      first?.focus();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', updatePosition);
    // Capture: nested scroll (overflow panels) does not bubble to `window` on
    // all engines; capture catches scrolls from any scrollable ancestor.
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  if (!open) return null;

  const menu = (
    <div
      id={contentId}
      ref={contentRef}
      role="menu"
      onKeyDown={onMenuKeyDown}
      className={cn(
        'fixed z-[200] animate-fade-in rounded-md border border-border/80 bg-popover/95 p-1 text-xs shadow-lift backdrop-blur',
        className,
      )}
      style={{
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        minWidth,
        maxHeight: 'min(80dvh, 32rem)',
        overflowY: 'auto',
        visibility: coords ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>
  );

  return createPortal(menu, document.body);
}

function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[data-menu-item]:not([disabled])',
    ),
  );
  if (items.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  const idx = items.findIndex((el) => el === active);
  const delta = event.key === 'ArrowDown' ? 1 : -1;
  const next = items[(idx + delta + items.length) % items.length];
  next?.focus();
}

interface MenuItemProps {
  icon?: LucideIcon;
  children: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  disabled?: boolean;
  description?: string;
  destructive?: boolean;
}

export function MenuItem({
  icon: Icon,
  children,
  onSelect,
  selected,
  disabled,
  description,
  destructive,
}: MenuItemProps) {
  const { setOpen } = useMenuContext('MenuItem');
  const handleClick = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (disabled) return;
      onSelect?.();
      setOpen(false);
    },
    [disabled, onSelect, setOpen],
  );
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        'group flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left transition-colors',
        disabled
          ? 'cursor-not-allowed text-muted-foreground/50'
          : destructive
            ? 'text-destructive hover:bg-destructive/10 focus:bg-destructive/10 focus:outline-none'
            : 'text-foreground/90 hover:bg-accent focus:bg-accent focus:outline-none',
        selected && 'bg-primary/10 text-primary',
      )}
    >
      {Icon ? (
        <Icon size={12} className="mt-[2px] flex-shrink-0 opacity-80" />
      ) : null}
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{children}</span>
        {description ? (
          <span className="text-[10px] text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {selected ? (
        <Check size={12} className="ml-auto mt-[2px] text-primary" />
      ) : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border/50" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
      {children}
    </div>
  );
}
