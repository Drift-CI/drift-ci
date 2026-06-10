import { NextResponse } from 'next/server';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';

import { AUDIT_KINDS, recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { checkOrigin } from '@/lib/origin';
import { rateLimit } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/route-auth';
import { apiTokens, users, type UserRole } from '@/lib/schema';
import { mintToken } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Scopes a caller may request when minting a token. We accept the
// known set; the role-intersection happens at validation time.
const KNOWN_SCOPES = [
  'runs:read',
  'runs:write',
  'tokens:manage',
  'audit:read',
] as const;

const MintBody = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(KNOWN_SCOPES)).min(1),
  expiresAt: z.string().datetime().optional(),
});

/** GET /api/v1/tokens — list tokens for the caller's user (admin: all). */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuth(request, { requiredScope: 'tokens:manage' });
  if (auth instanceof NextResponse) return auth;

  const db = getDb();
  // Admin sees every token; member/viewer never reach here (the scope
  // gate above filters them out).
  const rows = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      userEmail: users.email,
      userRole: users.role,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      createdAt: apiTokens.createdAt,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .orderBy(desc(apiTokens.createdAt));

  return NextResponse.json(
    {
      ok: true,
      tokens: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt?.toISOString() ?? null,
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
      })),
    },
    { status: 200 },
  );
}

/**
 * POST /api/v1/tokens — mint a token. Body:
 *   { name, scopes: ['runs:read', ...], expiresAt? }
 *
 * The plaintext is returned ONCE in the response and never persisted.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const origin = checkOrigin(request);
  if (!origin.ok) {
    return NextResponse.json(
      { ok: false, error: `origin: ${origin.reason}` },
      { status: 403 },
    );
  }

  const auth = await requireAuth(request, { requiredScope: 'tokens:manage' });
  if (auth instanceof NextResponse) return auth;

  // 30 mints/min per token. Generous for normal admin work; bounds a
  // compromised admin token that's spraying mint requests.
  const rl = await rateLimit({
    key: `tokens:mint:${auth.tokenId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl.resetAt);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `invalid JSON: ${(err as Error).message}` },
      { status: 400 },
    );
  }
  const parsed = MintBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'validation failed',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  // Bootstrap principals can't mint tokens for themselves — they don't
  // have a real user row. Force them to seed an admin first.
  if (auth.userId === 'bootstrap') {
    return NextResponse.json(
      {
        ok: false,
        error:
          'bootstrap principal cannot mint tokens; seed a real admin via DRIFT_ADMIN_EMAIL first',
      },
      { status: 409 },
    );
  }

  // Tokens are minted under the calling user. M20b ships single-user
  // mint; multi-user delegation lands later.
  const db = getDb();
  const callerRows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);
  const caller = callerRows[0];
  /* c8 ignore next 4 -- defensive: validateApiToken already verified the user. */
  if (!caller) {
    return NextResponse.json({ ok: false, error: 'user vanished' }, { status: 410 });
  }

  const minted = await mintToken();
  await db.insert(apiTokens).values({
    id: minted.id,
    userId: caller.id,
    name: parsed.data.name,
    prefix: minted.prefix,
    hash: minted.hash,
    scopes: parsed.data.scopes,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  });

  await recordAudit(db, {
    userId: caller.id,
    tokenId: minted.id,
    kind: AUDIT_KINDS.TOKEN_MINTED,
    target: minted.id,
    data: {
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      hasExpiry: parsed.data.expiresAt != null,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      token: {
        id: minted.id,
        prefix: minted.prefix,
        plaintext: minted.plaintext,
        name: parsed.data.name,
        scopes: parsed.data.scopes,
        userId: caller.id,
        role: caller.role satisfies UserRole,
      },
    },
    { status: 201 },
  );
}

function rateLimitResponse(resetAt: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { ok: false, error: 'rate-limited' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}
