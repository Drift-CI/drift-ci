import type { JSX } from 'react';
import { formatScore } from '@/lib/format';

interface ScorePillProps {
  score: number;
  threshold?: number;
}

export function ScorePill({ score, threshold }: ScorePillProps): JSX.Element {
  const tone = pickTone(score, threshold);
  return (
    <span
      className={`inline-flex min-w-[3.5rem] justify-center rounded px-2 py-0.5 font-mono text-xs font-medium ${tone}`}
    >
      {formatScore(score)}
    </span>
  );
}

function pickTone(score: number, threshold?: number): string {
  if (Number.isNaN(score)) {
    return 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400';
  }
  if (typeof threshold === 'number') {
    if (score >= 1 - threshold) {
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
    }
    if (score >= 0.5) {
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
    }
    return 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300';
  }
  if (score >= 0.9) {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  if (score >= 0.5) {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  }
  return 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300';
}
