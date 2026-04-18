import type { HTMLAttributes } from 'react';
import type { EnvTag } from '@shared/types/profile';
import { cn } from '../../lib/utils';

interface EnvBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  envTag: EnvTag;
  /** Shows a soft pulsing dot — useful for currently-active / prod indicators. */
  pulse?: boolean;
}

const envClass: Record<EnvTag, string> = {
  dev: 'bg-env-dev/15 text-env-dev border-env-dev/40',
  staging: 'bg-env-staging/15 text-env-staging border-env-staging/40',
  prod: 'bg-env-prod/15 text-env-prod border-env-prod/40',
};

export function EnvBadge({ envTag, pulse, className, ...props }: EnvBadgeProps) {
  const shouldPulse = pulse ?? envTag === 'prod';
  return (
    <span className={cn('badge uppercase tracking-wider', envClass[envTag], className)} {...props}>
      {shouldPulse ? (
        <span className="relative flex h-1.5 w-1.5 items-center justify-center">
          <span
            className="absolute inline-flex h-full w-full rounded-full opacity-80 animate-ping-soft"
            style={{ backgroundColor: 'currentColor' }}
          />
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: 'currentColor' }}
          />
        </span>
      ) : null}
      {envTag}
    </span>
  );
}
