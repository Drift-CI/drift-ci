import { NextResponse } from 'next/server';

import { getDb } from '@/lib/db';
import { getRunById } from '@/lib/queries';
import { requireAuth } from '@/lib/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/runs/[id]
 *
 * Returns the full run envelope (including the embedded cases array).
 * Requires `runs:read` scope.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth(request, { requiredScope: 'runs:read' });
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    const run = await getRunById(getDb(), id);
    if (!run) {
      return NextResponse.json(
        { ok: false, error: 'run not found' },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        run: {
          ...run,
          startedAt: run.startedAt.toISOString(),
          completedAt: run.completedAt.toISOString(),
          receivedAt: run.receivedAt.toISOString(),
        },
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
