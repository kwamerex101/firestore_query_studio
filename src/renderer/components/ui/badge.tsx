import type { HTMLAttributes } from 'react';
import type { EnvTag, Engine } from '@shared/types/profile';
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

interface EngineBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  engine: Engine;
}

const engineLabel: Record<Engine, string> = {
  firestore: 'Firestore',
  postgres: 'Postgres',
  mysql: 'MySQL',
  mssql: 'SQL Server',
};

const engineClass: Record<Engine, string> = {
  firestore: 'border-amber-400/40 bg-amber-400/10 text-amber-400',
  postgres: 'border-sky-400/40 bg-sky-400/10 text-sky-400',
  mysql: 'border-teal-400/40 bg-teal-400/10 text-teal-400',
  mssql: 'border-indigo-400/40 bg-indigo-400/10 text-indigo-400',
};

export function EngineBadge({ engine, className, ...props }: EngineBadgeProps) {
  return (
    <span
      className={cn('badge uppercase tracking-wider', engineClass[engine], className)}
      {...props}
    >
      {engineLabel[engine]}
    </span>
  );
}

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
