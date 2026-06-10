import { NextResponse } from 'next/server';
import { pingDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness + readiness probe. Returns 200 when the app is up AND can
 * reach the database; 503 when the DB check fails. Ops wire this into
 * docker-compose `healthcheck` and any reverse-proxy upstream probes.
 */
export async function GET(): Promise<NextResponse> {
  const db = await pingDb();
  const body = {
    ok: db.ok,
    version: process.env.npm_package_version ?? '0.0.0',
    db,
  };
  return NextResponse.json(body, { status: db.ok ? 200 : 503 });
}
