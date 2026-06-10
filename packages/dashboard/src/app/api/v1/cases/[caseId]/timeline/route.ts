import { NextResponse } from 'next/server';

import { getDb } from '@/lib/db';
import { getCaseTimeline } from '@/lib/queries';
import { requireAuth } from '@/lib/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/cases/[caseId]/timeline?suiteHash=&limit=
 *
 * Returns the historical (capturedAt, score) series for `caseId`,
 * ordered oldest → newest. Filters by `suiteHash` when supplied so
 * runs against a different suite definition don't pollute the chart.
 * Requires `runs:read` scope.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth(request, { requiredScope: 'runs:read' });
  if (auth instanceof NextResponse) return auth;

  const { caseId } = await params;
  const url = new URL(request.url);
  const suiteHash = url.searchParams.get('suiteHash') ?? undefined;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  try {
    const points = await getCaseTimeline(getDb(), {
      caseId,
      suiteHash,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json(
      {
        ok: true,
        caseId,
        points: points.map((p) => ({
          ...p,
          capturedAt: p.capturedAt.toISOString(),
        })),
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
