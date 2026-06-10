import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { DiffView } from '@/components/diff-view';
import { EmptyState } from '@/components/empty-state';
import { PageShell } from '@/components/page-shell';
import { ScorePill } from '@/components/score-pill';
import { StatusBadge } from '@/components/status-badge';
import { TimelineChart } from '@/components/timeline-chart';
import { getDb } from '@/lib/db';
import { diffLines, diffStats } from '@/lib/diff';
import { formatDateTime, formatLatency, shortId } from '@/lib/format';
import {
  extractCase,
  getCaseTimeline,
  getPreviousSnapshotForCase,
  getRunById,
} from '@/lib/queries';
import { requireSession } from '@/lib/require-session';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; caseId: string }>;
}

export default async function CaseDetailPage({
  params,
}: PageProps): Promise<JSX.Element> {
  const { id, caseId } = await params;
  const session = await requireSession({
    targetPath: `/runs/${id}/cases/${caseId}`,
  });

  let run;
  try {
    run = await getRunById(getDb(), id);
  } catch (err) {
    return (
      <PageShell
        session={{ email: session.email, role: session.role }}
        title="Case unavailable"
        subtitle={shortId(id)}
      >
        <EmptyState
          title="Database unreachable"
          hint={(err as Error).message}
        />
      </PageShell>
    );
  }
  if (!run) notFound();

  const c = extractCase(run, caseId);
  if (!c) notFound();

  // Fire snapshot lookups in parallel — both are independent reads.
  const db = getDb();
  const [previous, timeline] = await Promise.all([
    getPreviousSnapshotForCase(db, {
      caseId,
      currentRunCapturedAt: run.completedAt,
    }),
    getCaseTimeline(db, { caseId }),
  ]);

  const breakdown = c.evaluatorBreakdown ?? {};
  const breakdownEntries = Object.entries(breakdown);

  const diff =
    previous && previous.output != null
      ? diffLines(previous.output, c.output ?? '')
      : null;
  const stats = diff ? diffStats(diff) : null;

  return (
    <PageShell
      session={{ email: session.email, role: session.role }}
      title={
        <>
          Case <span className="font-mono text-base">{c.caseId}</span>
        </>
      }
      subtitle={
        <>
          From run{' '}
          <Link
            href={`/runs/${run.id}`}
            className="font-mono text-sm hover:underline"
          >
            {shortId(run.id)}
          </Link>{' '}
          · {formatDateTime(run.startedAt)}
        </>
      }
      actions={
        <Link
          href={`/runs/${run.id}`}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          ← Back to run
        </Link>
      }
    >
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Status" value={<StatusBadge status={c.status} />} />
        <Stat
          label="Score"
          value={<ScorePill score={c.score} threshold={c.threshold} />}
        />
        <Stat label="Threshold" value={<Mono>{c.threshold.toFixed(2)}</Mono>} />
        <Stat label="Latency" value={<Mono>{formatLatency(c.latencyMs)}</Mono>} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Output
        </h2>
        <pre className="max-h-[40vh] overflow-auto rounded-xl border border-neutral-200 bg-white p-4 font-mono text-xs leading-relaxed text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
          {c.output ?? '(no output)'}
        </pre>
      </section>

      {c.error ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-rose-600 dark:text-rose-400">
            Error
          </h2>
          <pre className="overflow-auto rounded-xl border border-rose-200 bg-rose-50 p-4 font-mono text-xs text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
            {c.error}
          </pre>
        </section>
      ) : null}

      {breakdownEntries.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Evaluator breakdown
          </h2>
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-2 text-left">Evaluator</th>
                  <th className="px-4 py-2 text-left">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {breakdownEntries.map(([name, detail]) => (
                  <tr key={name}>
                    <td className="px-4 py-2 font-mono text-xs">{name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-neutral-700 dark:text-neutral-300">
                      <pre className="whitespace-pre-wrap">{JSON.stringify(detail, null, 2)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Drift timeline
        </h2>
        <TimelineChart
          points={timeline}
          threshold={c.threshold}
          highlightRunId={run.id}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Output vs previous baseline
        </h2>
        {diff && stats && previous ? (
          <>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Compared against run{' '}
              <Link
                href={`/runs/${previous.runId}/cases/${encodeURIComponent(c.caseId)}`}
                className="font-mono hover:underline"
                title={previous.runId}
              >
                {shortId(previous.runId)}
              </Link>{' '}
              captured{' '}
              <span title={previous.capturedAt.toISOString()}>
                {formatDateTime(previous.capturedAt)}
              </span>{' '}
              · score {previous.score.toFixed(3)} →{' '}
              <span className="font-mono">{c.score.toFixed(3)}</span>
            </p>
            <DiffView diff={diff} stats={stats} />
          </>
        ) : previous ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Previous snapshot found (run{' '}
            <span className="font-mono">{shortId(previous.runId)}</span>) but the
            run envelope is no longer available — likely retention-pruned. Score
            history is still shown above.
          </p>
        ) : (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            No prior baseline for this case yet — this is its first recorded
            run.
          </p>
        )}
      </section>
    </PageShell>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: JSX.Element;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </div>
      <div className="mt-2">{value}</div>
    </div>
  );
}

function Mono({ children }: { children: JSX.Element | string }): JSX.Element {
  return (
    <span className="font-mono text-base text-neutral-900 dark:text-neutral-100">
      {children}
    </span>
  );
}
