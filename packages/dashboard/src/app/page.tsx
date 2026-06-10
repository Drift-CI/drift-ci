import Link from 'next/link';
import type { JSX } from 'react';

import { EmptyState } from '@/components/empty-state';
import { PageShell } from '@/components/page-shell';
import { RunListWithPicker, type RunListRow } from '@/components/run-list-with-picker';
import { clampLimit, decodeCursor } from '@/lib/cursor';
import { getDb } from '@/lib/db';
import { listRunsPaged, type RunListItem } from '@/lib/queries';
import { requireSession } from '@/lib/require-session';

export const dynamic = 'force-dynamic';

interface RunSummary {
  total: number;
  passed: number;
  regressions: number;
  avgScore: number;
}

function readSummary(item: RunListItem): RunSummary {
  const raw = item.data as { summary?: Partial<RunSummary> } | null;
  const s = raw?.summary ?? {};
  return {
    total: typeof s.total === 'number' ? s.total : 0,
    passed: typeof s.passed === 'number' ? s.passed : 0,
    regressions: typeof s.regressions === 'number' ? s.regressions : 0,
    avgScore: typeof s.avgScore === 'number' ? s.avgScore : NaN,
  };
}

interface PageProps {
  searchParams: Promise<{
    suiteId?: string;
    limit?: string;
    cursor?: string;
  }>;
}

export default async function HomePage({
  searchParams,
}: PageProps): Promise<JSX.Element> {
  const session = await requireSession({ targetPath: '/' });
  const params = await searchParams;
  const suiteId = params.suiteId;
  const limit = clampLimit(params.limit);
  const cursor = decodeCursor(params.cursor);

  let result;
  let dbError: string | null = null;
  try {
    result = await listRunsPaged(getDb(), { suiteId, limit, cursor });
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
    result = { rows: [], nextCursor: null };
  }

  return (
    <PageShell
      session={{ email: session.email, role: session.role }}
      title={suiteId ? `Suite: ${suiteId}` : 'Run history'}
      subtitle={
        suiteId
          ? 'Filtered by suite. Remove the filter to see all suites.'
          : `Most recent ${limit} runs across all suites.`
      }
      actions={
        suiteId ? (
          <Link
            href="/"
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          >
            Clear filter
          </Link>
        ) : null
      }
    >
      {dbError ? (
        <EmptyState
          title="Database unreachable"
          hint={
            <>
              Check{' '}
              <code className="font-mono text-xs">DATABASE_URL</code> and that
              migrations have been applied. Detail:{' '}
              <code className="font-mono text-xs">{dbError}</code>
            </>
          }
        />
      ) : result.rows.length === 0 ? (
        <EmptyState
          title="No runs yet"
          hint={
            <>
              Configure your CLI or Action to sync to this dashboard with{' '}
              <code className="font-mono text-xs">storage: {`{ type: http }`}</code>{' '}
              and the runs will appear here.
            </>
          }
        />
      ) : (
        <RunListWithPicker rows={result.rows.map(toRow)} />
      )}

      {result.nextCursor ? (
        <div className="flex justify-end">
          <Link
            href={buildLink(suiteId, limit, result.nextCursor)}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          >
            Older →
          </Link>
        </div>
      ) : null}
    </PageShell>
  );
}

function toRow(item: RunListItem): RunListRow {
  const s = readSummary(item);
  return {
    id: item.id,
    suiteId: item.suiteId,
    provider: item.provider,
    startedAt: item.startedAt,
    total: s.total,
    passed: s.passed,
    regressions: s.regressions,
    avgScore: s.avgScore,
  };
}

function buildLink(
  suiteId: string | undefined,
  limit: number,
  cursor: string,
): string {
  const search = new URLSearchParams();
  if (suiteId) search.set('suiteId', suiteId);
  if (limit !== 20) search.set('limit', String(limit));
  search.set('cursor', cursor);
  return `/?${search.toString()}`;
}
