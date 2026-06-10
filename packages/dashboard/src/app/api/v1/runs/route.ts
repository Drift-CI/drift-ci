import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { AUDIT_KINDS, recordAudit } from '@/lib/audit';
import { clampLimit, decodeCursor } from '@/lib/cursor';
import { getDb } from '@/lib/db';
import { IngestEnvelopeSchema, ingestRun } from '@/lib/ingest';
import { listRunsPaged } from '@/lib/queries';
import { rateLimit } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/runs
 *
 * Ingest endpoint for drift-ci HttpStorage clients. Writes a `runs`
 * row and one `baseline_snapshots` row per case (when the client
 * supplies an IngestContext with per-case suiteHashes). Idempotent:
 * repeat POSTs with the same payload are no-ops.
 *
 * Auth: per-user API token via `Authorization: Bearer drift_<...>` —
 * see lib/tokens.ts and lib/auth.ts. The `DRIFT_INGEST_TOKEN` env var
 * still works as a bootstrap fallback when the DB has zero users.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireAuth(request, { requiredScope: 'runs:write' });
  if (auth instanceof NextResponse) return auth;

  // 60 ingests/min per token. Generous for normal CI; bounds a runaway
  // workflow that retries forever. The 429 includes Retry-After.
  const rl = await rateLimit({
    key: `ingest:${auth.tokenId}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl.resetAt);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `invalid JSON: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const parsed = IngestEnvelopeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'validation failed', issues: toIssuePaths(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const outcome = await ingestRun(db, parsed.data);
    if (outcome.runInserted) {
      await recordAudit(db, {
        userId: auth.userId === 'bootstrap' ? null : auth.userId,
        tokenId: auth.tokenId === 'bootstrap' ? null : auth.tokenId,
        kind: AUDIT_KINDS.RUN_INGESTED,
        target: outcome.runId,
        data: {
          snapshotsWritten: outcome.snapshotsWritten,
        },
      });
    }
    return NextResponse.json(
      { ok: true, ...outcome },
      { status: outcome.runInserted ? 201 : 200 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * GET /api/v1/runs?suiteId=&limit=&cursor=
 *
 * Cursor-paginated run list. Requires `runs:read` scope.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuth(request, { requiredScope: 'runs:read' });
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const suiteId = url.searchParams.get('suiteId') ?? undefined;
  const limit = clampLimit(url.searchParams.get('limit'));
  const cursor = decodeCursor(url.searchParams.get('cursor'));

  try {
    const { rows, nextCursor } = await listRunsPaged(getDb(), {
      suiteId,
      limit,
      cursor,
    });
    return NextResponse.json(
      {
        ok: true,
        runs: rows.map((r) => ({
          ...r,
          startedAt: r.startedAt.toISOString(),
          completedAt: r.completedAt.toISOString(),
          receivedAt: r.receivedAt.toISOString(),
        })),
        nextCursor,
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

function toIssuePaths(err: ZodError): string[] {
  return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

function rateLimitResponse(resetAt: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { ok: false, error: 'rate-limited' },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
    },
  );
}
