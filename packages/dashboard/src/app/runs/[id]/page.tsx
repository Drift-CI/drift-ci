import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageShell } from '@/components/page-shell';
import { ScorePill } from '@/components/score-pill';
import { StatusBadge } from '@/components/status-badge';
import { getDb } from '@/lib/db';
import { formatDateTime, formatLatency, shortId } from '@/lib/format';
import { getRunById, type RunCase } from '@/lib/queries';
import { requireSession } from '@/lib/require-session';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface RunData {
  cases?: RunCase[];
  summary?: {
    total?: number;
    passed?: number;
    transient?: number;
    evaluatorErrors?: number;
    regressions?: number;
    avgScore?: number;
    avgLatencyMs?: number;
  };
}

export default async function RunDetailPage({
  params,
}: PageProps): Promise<JSX.Element> {
  const { id } = await params;
  const session = await requireSession({ targetPath: `/runs/${id}` });

  let run;
  try {
    run = await getRunById(getDb(), id);
  } catch (err) {
    return (
      <PageShell
        session={{ email: session.email, role: session.role }}
        title="Run unavailable"
        subtitle={shortId(id)}
      >
        <EmptyState
          title="Database unreachable"
          hint={(err as Error).message}
        />
      </PageShell>
    );
  }
  if (!run) {
    notFound();
  }

  const data = run.data as RunData | null;
  const summary = data?.summary ?? {};
  const cases = data?.cases ?? [];

  return (
    <PageShell
      session={{ email: session.email, role: session.role }}
      title={
        <>
          Run <span className="font-mono text-base">{shortId(run.id)}</span>
        </>
      }
      subtitle={
        <>
          Suite{' '}
          <Link
            href={`/?suiteId=${encodeURIComponent(run.suiteId)}`}
            className="font-medium hover:underline"
          >
            {run.suiteId}
          </Link>{' '}
          · provider{' '}
          <code className="font-mono text-xs">{run.provider}</code>
        </>
      }
      actions={
        <Link
          href="/"
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          ← All runs
        </Link>
      }
    >
      <SummaryGrid summary={summary} startedAt={run.startedAt} />

      {cases.length === 0 ? (
        <EmptyState title="No cases recorded for this run." />
      ) : (
        <CaseTable runId={run.id} cases={cases} />
      )}
    </PageShell>
  );
}

function SummaryGrid({
  summary,
  startedAt,
}: {
  summary: NonNullable<RunData['summary']>;
  startedAt: Date;
}): JSX.Element {
  const stats: Array<{ label: string; value: string; emphasis?: boolean }> = [
    { label: 'Started', value: formatDateTime(startedAt) },
    {
      label: 'Cases',
      value: `${summary.passed ?? 0}/${summary.total ?? 0}`,
    },
    {
      label: 'Regressions',
      value: String(summary.regressions ?? 0),
      emphasis: (summary.regressions ?? 0) > 0,
    },
    {
      label: 'Transient',
      value: String(summary.transient ?? 0),
    },
    {
      label: 'Avg score',
      value:
        typeof summary.avgScore === 'number'
          ? summary.avgScore.toFixed(3)
          : '—',
    },
    {
      label: 'Avg latency',
      value: formatLatency(summary.avgLatencyMs ?? NaN),
    },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {s.label}
          </div>
          <div
            className={`mt-1 font-mono text-base ${s.emphasis ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-neutral-900 dark:text-neutral-100'}`}
          >
            {s.value}
          </div>
        </div>
      ))}
    </section>
  );
}

function CaseTable({
  runId,
  cases,
}: {
  runId: string;
  cases: RunCase[];
}): JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
          <tr>
            <th className="px-4 py-2 text-left">Case</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-right">Score</th>
            <th className="px-4 py-2 text-right">Threshold</th>
            <th className="px-4 py-2 text-right">Latency</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {cases.map((c) => (
            <tr
              key={c.caseId}
              className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            >
              <td className="px-4 py-2 font-mono text-xs">
                <Link
                  href={`/runs/${runId}/cases/${encodeURIComponent(c.caseId)}`}
                  className="text-neutral-900 hover:underline dark:text-neutral-100"
                >
                  {c.caseId}
                </Link>
              </td>
              <td className="px-4 py-2">
                <StatusBadge status={c.status} />
              </td>
              <td className="px-4 py-2 text-right">
                <ScorePill score={c.score} threshold={c.threshold} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                {c.threshold.toFixed(2)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                {formatLatency(c.latencyMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
