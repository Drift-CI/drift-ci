import type { JSX } from 'react';
import type { DiffLine, DiffStats } from '@/lib/diff';

interface DiffViewProps {
  diff: readonly DiffLine[];
  stats: DiffStats;
}

export function DiffView({ diff, stats }: DiffViewProps): JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
        <span>Output diff</span>
        <span className="flex gap-3 font-mono normal-case tracking-normal">
          <span className="text-emerald-700 dark:text-emerald-400">
            +{stats.added}
          </span>
          <span className="text-rose-700 dark:text-rose-400">
            −{stats.removed}
          </span>
          <span className="text-neutral-500 dark:text-neutral-400">
            ={stats.unchanged}
          </span>
        </span>
      </div>
      <pre className="max-h-[60vh] overflow-auto bg-white text-xs leading-relaxed text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
        {diff.map((line, i) => (
          <DiffRow key={i} line={line} />
        ))}
      </pre>
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }): JSX.Element {
  const tone = pickTone(line.tag);
  const marker = line.tag === '+' ? '+' : line.tag === '-' ? '-' : ' ';
  return (
    <div className={`grid grid-cols-[3rem_3rem_2rem_1fr] gap-0 ${tone}`}>
      <span className="px-2 text-right font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
        {line.beforeLine ?? ''}
      </span>
      <span className="px-2 text-right font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
        {line.afterLine ?? ''}
      </span>
      <span className="select-none px-2 text-center font-mono">{marker}</span>
      <span className="whitespace-pre-wrap break-words pr-3 font-mono">
        {line.text}
      </span>
    </div>
  );
}

function pickTone(tag: DiffLine['tag']): string {
  switch (tag) {
    case '+':
      return 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200';
    case '-':
      return 'bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-200';
    /* c8 ignore next 2 */
    default:
      return '';
  }
}
