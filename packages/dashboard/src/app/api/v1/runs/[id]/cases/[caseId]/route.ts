import { NextResponse } from 'next/server';

import { getDb } from '@/lib/db';
import { diffLines, diffStats } from '@/lib/diff';
import {
  extractCase,
  getPreviousSnapshotForCase,
  getRunById,
} from '@/lib/queries';
import { requireAuth } from '@/lib/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/runs/[id]/cases/[caseId]
 *
 * Returns a single case from the run, the closest prior snapshot, and
 * a server-side rendered line diff. Requires `runs:read` scope.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; caseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth(request, { requiredScope: 'runs:read' });
  if (auth instanceof NextResponse) return auth;

  const { id, caseId } = await params;

  try {
    const run = await getRunById(getDb(), id);
    if (!run) {
      return NextResponse.json(
        { ok: false, error: 'run not found' },
        { status: 404 },
      );
    }
    const caseResult = extractCase(run, caseId);
    if (!caseResult) {
      return NextResponse.json(
        { ok: false, error: 'case not found in this run' },
        { status: 404 },
      );
    }
    // Look up the most recent snapshot strictly older than this run's
    // completion time. The diff is rendered server-side so the client
    // doesn't need a diff library bundled.
    const previous = await getPreviousSnapshotForCase(getDb(), {
      caseId,
      currentRunCapturedAt: run.completedAt,
    });
    const diff =
      previous && previous.output != null
        ? diffLines(previous.output, caseResult.output ?? '')
        : null;
    return NextResponse.json(
      {
        ok: true,
        run: {
          id: run.id,
          suiteId: run.suiteId,
          provider: run.provider,
          startedAt: run.startedAt.toISOString(),
          completedAt: run.completedAt.toISOString(),
        },
        case: caseResult,
        previous: previous
          ? {
              ...previous,
              capturedAt: previous.capturedAt.toISOString(),
            }
          : null,
        diff: diff
          ? {
              lines: diff,
              stats: diffStats(diff),
            }
          : null,
      },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
