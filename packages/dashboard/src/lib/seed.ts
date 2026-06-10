import { randomUUID } from 'node:crypto';

import type { Db } from './db';
import { apiTokens, users } from './schema';
import { mintToken } from './tokens';

export interface SeedOutcome {
  /**
   * `created` — a fresh admin + bootstrap token were inserted. The
   *             plaintext is in `tokenPlaintext` and is shown ONCE.
   * `existing-users` — at least one user already exists; nothing done.
   * `no-admin-email` — `DRIFT_ADMIN_EMAIL` is not set; nothing done.
   */
  status: 'created' | 'existing-users' | 'no-admin-email';
  email?: string;
  tokenPlaintext?: string;
}

export interface SeedFirstAdminParams {
  email: string | undefined;
  /** Override clock for tests. */
  now?: Date;
}

/**
 * If the database has no users yet AND DRIFT_ADMIN_EMAIL is set, create
 * the admin and an initial token. Idempotent: re-running on a populated
 * DB is a no-op. Designed to be called from container start, right
 * after migrations apply.
 *
 * The plaintext token is returned exactly once. Container entry-points
 * print it to stdout; callers in tests assert on the return value.
 */
export async function seedFirstAdmin(
  db: Db,
  params: SeedFirstAdminParams,
): Promise<SeedOutcome> {
  if (!params.email) return { status: 'no-admin-email' };

  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) return { status: 'existing-users' };

  const userId = randomUUID();
  const minted = await mintToken();
  const now = params.now ?? new Date();

  await db.insert(users).values({
    id: userId,
    email: params.email,
    role: 'admin',
    createdAt: now,
  });

  await db.insert(apiTokens).values({
    id: minted.id,
    userId,
    name: 'bootstrap',
    prefix: minted.prefix,
    hash: minted.hash,
    scopes: ['runs:read', 'runs:write', 'tokens:manage', 'audit:read'],
    createdAt: now,
  });

  return {
    status: 'created',
    email: params.email,
    tokenPlaintext: minted.plaintext,
  };
}
