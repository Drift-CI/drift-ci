import type { JSX } from 'react';

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps): JSX.Element {
  const tone = pickTone(status);
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${tone}`}
    >
      {status}
    </span>
  );
}

function pickTone(status: string): string {
  switch (status) {
    case 'pass':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'evaluator-error':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
    case 'provider-rate-limit':
    case 'provider-network':
    case 'timeout':
      return 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300';
    case 'provider-auth':
      return 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300';
    /* c8 ignore next 2 */
    default:
      return 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
  }
}
