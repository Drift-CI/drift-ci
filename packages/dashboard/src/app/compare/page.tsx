import type { JSX } from 'react';
import Link from 'next/link';

import { ScorePill } from '@/components/score-pill';
import { PageShell } from '@/components/page-shell';
import { getDb } from '@/lib/db';
import { getRunById, type RunDetail } from '@/lib/queries';
import { requireSession } from '@/lib/require-session';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ runs?: string }>;
}

interface RunCase {
  caseId: string;
  score: number;
  threshold?: number;
  status?: string;
}

interface FetchedRun {
  id: string;
  provider: string;
  suiteId: string;
  cases: RunCase[];
  avgScore: number;
}

export default async function ComparePage({
  searchParams,
}: PageProps): Promise<JSX.Element> {
  const session = await requireSession({ targetPath: '/compare' });

  const params = await searchParams;
  const ids = parseRunIds(params.runs);

  return (
    <PageShell
      session={{ email: session.email, role: session.role }}
      title="Provider comparison"
      subtitle="Side-by-side per-case scores across two or more runs of the same suite."
    >
      {ids.length === 0 ? (
        <UsageHint />
      ) : ids.length === 1 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Pass at least two run-ids:{' '}
          <code className="font-mono text-xs">/compare?runs=id1,id2</code>.
        </div>
      ) : (
        <ComparisonView ids={ids} />
      )}
    </PageShell>
  );
}

function parseRunIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8); // 8 column cap for readability
}

function UsageHint(): JSX.Element {
  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <p>
        Compare runs by passing their ids in the URL:
      </p>
      <pre className="rounded-md bg-neutral-100 p-3 font-mono text-xs dark:bg-neutral-950">
        /compare?runs=run-uuid-a,run-uuid-b,run-uuid-c
      </pre>
      <p className="text-neutral-600 dark:text-neutral-400">
        Up to 8 runs supported. Each run must already have been ingested via the CLI{' '}
        (<code className="font-mono text-xs">drift-ci run</code>) or GitHub Action.
      </p>
      <p className="text-neutral-600 dark:text-neutral-400">
        Run ids are visible at the top of each run-detail page — open{' '}
        <Link href="/" className="text-sky-600 hover:underline dark:text-sky-400">
          the run history
        </Link>{' '}
        and copy two from the URL bar.
      </p>
      <p className="text-neutral-600 dark:text-neutral-400">
        For ad-hoc comparison without storing runs, use the CLI:
      </p>
      <pre className="rounded-md bg-neutral-100 p-3 font-mono text-xs dark:bg-neutral-950">
        npx drift-ci compare --providers anthropic:claude-sonnet-4-5,openai:gpt-4o-mini
      </pre>
    </div>
  );
}

async function ComparisonView({ ids }: { ids: string[] }): Promise<JSX.Element> {
  const db = getDb();
  const fetched = await Promise.all(
    ids.map(async (id) => ({ id, row: await getRunById(db, id) })),
  );
  const missing = fetched.filter((f) => !f.row).map((f) => f.id);
  const found = fetched
    .filter((f): f is { id: string; row: RunDetail } => f.row !== null)
    .map((f) => extractRun(f.row));

  if (found.length < 2) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
        Need at least 2 valid runs to compare. Missing:{' '}
        <code className="font-mono text-xs">{missing.join(', ') || '(none)'}</code>
      </div>
    );
  }

  const distinctSuites = new Set(found.map((r) => r.suiteId));
  const suiteWarning =
    distinctSuites.size > 1 ? (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        Selected runs span multiple suites:{' '}
        <code className="font-mono text-xs">
          {[...distinctSuites].join(', ')}
        </code>
        . The comparison may not be meaningful unless all runs share the same suite.
      </div>
    ) : null;

  // Union of all case ids, sorted, becomes the row order. Cases that
  // appear in some runs but not others surface as `null` cells.
  const allCaseIds = [
    ...new Set(found.flatMap((r) => r.cases.map((c) => c.caseId))),
  ].sort();

  const rows = allCaseIds.map((caseId) => {
    const scores = found.map(
      (r) => r.cases.find((c) => c.caseId === caseId)?.score ?? null,
    );
    return { caseId, scores, winnerIndex: pickWinnerIndex(scores) };
  });

  const winsByProvider = new Array(found.length).fill(0);
  for (const row of rows) {
    if (row.winnerIndex !== null) winsByProvider[row.winnerIndex] += 1;
  }
  const overallWinnerIndex = pickWinnerIndex(found.map((r) => r.avgScore));

  return (
    <>
      {suiteWarning}
      {missing.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Skipping unknown run-ids:{' '}
          <code className="font-mono text-xs">{missing.join(', ')}</code>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
            <tr>
              <th className="px-4 py-2 text-left">Case</th>
              {found.map((r) => (
                <th key={r.id} className="px-4 py-2 text-left">
                  <Link
                    href={`/runs/${r.id}`}
                    className="font-mono text-xs text-sky-600 hover:underline dark:text-sky-400"
                    title={r.id}
                  >
                    {r.provider}
                  </Link>
                </th>
              ))}
              <th className="px-4 py-2 text-left">Winner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {rows.map((row) => (
              <tr key={row.caseId}>
                <td className="px-4 py-2 font-mono text-xs">{row.caseId}</td>
                {row.scores.map((s, idx) => (
                  <td
                    key={`${row.caseId}-${idx}`}
                    className={`px-4 py-2 ${
                      row.winnerIndex === idx
                        ? 'bg-emerald-50 dark:bg-emerald-950/30'
                        : ''
                    }`}
                  >
                    {s === null ? (
                      <span className="text-neutral-400">—</span>
                    ) : (
                      <ScorePill score={s} />
                    )}
                  </td>
                ))}
                <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">
                  {row.winnerIndex === null
                    ? <span className="italic">tie</span>
                    : <span className="font-mono text-xs">{shortName(found[row.winnerIndex].provider)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-neutral-200 bg-neutral-50 text-xs dark:border-neutral-800 dark:bg-neutral-950">
            <tr>
              <td className="px-4 py-2 font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Average
              </td>
              {found.map((r, idx) => (
                <td
                  key={`avg-${r.id}`}
                  className={`px-4 py-2 font-medium ${
                    overallWinnerIndex === idx
                      ? 'bg-emerald-50 dark:bg-emerald-950/30'
                      : ''
                  }`}
                >
                  {r.avgScore.toFixed(3)}
                </td>
              ))}
              <td className="px-4 py-2"></td>
            </tr>
            <tr>
              <td className="px-4 py-2 font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Wins
              </td>
              {winsByProvider.map((n, idx) => (
                <td key={`w-${idx}`} className="px-4 py-2">
                  <span className="font-mono text-xs">{n}/{rows.length}</span>
                </td>
              ))}
              <td className="px-4 py-2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function pickWinnerIndex(scores: Array<number | null>): number | null {
  let max = -Infinity;
  let maxCount = 0;
  let maxIdx = -1;
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    if (s === null || Number.isNaN(s)) continue;
    if (s > max) {
      max = s;
      maxCount = 1;
      maxIdx = i;
    } else if (s === max) {
      maxCount += 1;
    }
  }
  if (maxIdx === -1 || maxCount > 1) return null;
  return maxIdx;
}

function extractRun(row: RunDetail): FetchedRun {
  const data = row.data as
    | { cases?: RunCase[]; summary?: { avgScore?: number } }
    | null;
  const cases = data?.cases ?? [];
  const avgScore = typeof data?.summary?.avgScore === 'number' ? data.summary.avgScore : 0;
  return {
    id: row.id,
    provider: row.provider,
    suiteId: row.suiteId,
    cases,
    avgScore,
  };
}

function shortName(provider: string): string {
  const slash = provider.indexOf('/');
  return slash >= 0 ? provider.slice(slash + 1) : provider;
}
