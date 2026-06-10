import type { JSX, ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  hint?: ReactNode;
}

export function EmptyState({ title, hint }: EmptyStateProps): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <p className="text-base font-medium text-neutral-900 dark:text-neutral-100">
        {title}
      </p>
      {hint ? (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
