import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'primary' | 'destructive' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'default' | 'sm' | 'icon';
  loading?: boolean;
}

const variantClass: Record<Variant, string> = {
  default: 'btn',
  primary: 'btn btn-primary',
  destructive: 'btn btn-destructive',
  ghost: 'btn btn-ghost',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size, loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          variantClass[variant],
          size === 'sm' && 'px-2 py-1 text-xs',
          size === 'icon' && 'h-7 w-7 p-0 touch:min-h-[44px] touch:min-w-[44px]',
          loading && 'cursor-progress',
          className,
        )}
        {...props}
      >
        {loading ? <span className="spinner" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
