'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';

import { ScorePill } from './score-pill';
import { formatDateTime, formatRelative, shortId } from '@/lib/format';

/**
 * Picker variant of the run-history table. Each row carries a
 * checkbox; selecting two or more enables a sticky "Compare" bar at
 * the bottom of the viewport that navigates to
 * `/compare?runs=<csv>`. Hard-caps selections at 8 to match the
 * compare page's column limit.
 *
 * The component takes its rows as plain props from the server page
 * — no client-side fetching. Only the selection state is local.
 */

export interface RunListRow {
  id: string;
  suiteId: string;
  provider: string;
  startedAt: Date;
  total: number;
  passed: number;
  regressions: number;
  avgScore: number;
}

const MAX_SELECTED = 8;

export function RunListWithPicker({ rows }: { rows: RunListRow[] }): JSX.Element {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= MAX_SELECTED) return prev;
      next.add(id);
      return next;
    });
  }

  function clear(): void {
    setSelected(new Set());
  }

  function compare(): void {
    if (selected.size < 2) return;
    // Preserve table row order in the URL — feels more natural than
    // selection insertion order when the user came back to tweak.
    const ordered = rows.map((r) => r.id).filter((id) => selected.has(id));
    router.push(`/compare?runs=${ordered.join(',')}`);
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
            <tr>
              <th className="w-8 px-3 py-2 text-left">
                <span className="sr-only">Select for compare</span>
              </th>
              <th className="px-4 py-2 text-left">Suite</th>
              <th className="px-4 py-2 text-left">Run</th>
              <th className="px-4 py-2 text-left">Provider</th>
              <th className="px-4 py-2 text-left">Started</th>
              <th className="px-4 py-2 text-right">Cases</th>
              <th className="px-4 py-2 text-right">Regressions</th>
              <th className="px-4 py-2 text-right">Avg score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {rows.map((r) => {
              const isSelected = selected.has(r.id);
              const atCap = !isSelected && selected.size >= MAX_SELECTED;
              return (
                <tr
                  key={r.id}
                  className={
                    isSelected
                      ? 'bg-sky-50 dark:bg-sky-950/30'
                      : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                  }
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select run ${shortId(r.id)} for comparison`}
                      checked={isSelected}
                      disabled={atCap}
                      onChange={() => toggle(r.id)}
                      className="h-4 w-4 cursor-pointer accent-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/?suiteId=${encodeURIComponent(r.suiteId)}`}
                      className="text-neutral-900 hover:underline dark:text-neutral-100"
                    >
                      {r.suiteId}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/runs/${r.id}`}
                      className="font-mono text-xs text-neutral-700 hover:underline dark:text-neutral-300"
                      title={r.id}
                    >
                      {shortId(r.id)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400">
                    {r.provider}
                  </td>
                  <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">
                    <span title={formatDateTime(r.startedAt)}>
                      {formatRelative(r.startedAt)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                    {r.passed}/{r.total}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <span
                      className={
                        r.regressions > 0
                          ? 'font-semibold text-rose-600 dark:text-rose-400'
                          : 'text-neutral-500 dark:text-neutral-400'
                      }
                    >
                      {r.regressions}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <ScorePill score={r.avgScore} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected.size > 0 ? (
        <div className="sticky bottom-4 z-10 mt-4 flex items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm shadow-md dark:border-sky-900/50 dark:bg-sky-950/60">
          <div className="text-neutral-700 dark:text-neutral-200">
            <span className="font-medium">{selected.size}</span>{' '}
            run{selected.size === 1 ? '' : 's'} selected
            {selected.size >= MAX_SELECTED ? (
              <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
                (max {MAX_SELECTED})
              </span>
            ) : null}
            {selected.size === 1 ? (
              <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
                — pick one more to compare
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clear}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={compare}
              disabled={selected.size < 2}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Compare →
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
