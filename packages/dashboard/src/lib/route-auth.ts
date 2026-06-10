import { NextResponse } from 'next/server';

import {
  validateApiToken,
  type AuthFailReason,
  type AuthOk,
} from './auth';
import { getDb } from './db';

/**
 * Route-handler-friendly wrapper around `validateApiToken`. Returns
 * either the validated principal (always `ok: true` — the union is
 * narrowed for the caller) or a NextResponse already shaped for the
 * failure mode. Routes call:
 *
 *   const auth = await requireAuth(request, { requiredScope: 'runs:write' });
 *   if (auth instanceof NextResponse) return auth;
 *   // auth.userId / auth.role / auth.scopes are now in scope.
 */
export async function requireAuth(
  request: Request,
  opts: { requiredScope?: string } = {},
): Promise<AuthOk | NextResponse> {
  const auth = await validateApiToken(
    request.headers.get('authorization'),
    getDb(),
    {
      requiredScope: opts.requiredScope,
      bootstrapToken: process.env.DRIFT_INGEST_TOKEN,
    },
  );
  if (auth.ok) return auth;

  const status = mapStatus(auth.reason);
  return NextResponse.json(
    { ok: false, error: `auth: ${auth.reason}` },
    { status },
  );
}

function mapStatus(reason: AuthFailReason): number {
  switch (reason) {
    case 'no-auth-configured':
      return 503;
    case 'insufficient-scope':
      return 403;
    /* c8 ignore next 2 */
    default:
      return 401;
  }
}
