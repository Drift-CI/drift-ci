#!/usr/bin/env node
// Minimal migration runner for drift-ci's dashboard.
//
// Reads every *.sql file under ./drizzle in lexicographic order and
// applies any that aren't already recorded in `schema_migrations`.
// Each file is executed inside a transaction and recorded on success.
//
// This is intentionally simpler than drizzle-kit's migrator so ops can
// understand what ran just by reading the SQL files committed to the
// repo — no opaque journal format required.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/migrate.mjs
//   pnpm --filter @drift-ci/dashboard db:migrate

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'drizzle');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('migrate: DATABASE_URL is required.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql`SELECT name FROM schema_migrations`).map((r) => r.name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`migrate: skip ${file} (already applied)`);
      continue;
    }
    const body = readFileSync(join(migrationsDir, file), 'utf8');
    console.log(`migrate: apply ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
  }
  console.log('migrate: done.');

  // First-admin seeding. Idempotent: skipped when any user already
  // exists, regardless of whether DRIFT_ADMIN_EMAIL is set. The
  // bootstrap token is printed to stdout exactly once — capture it
  // before deploying with a real admin flow in M20b.
  await seedFirstAdmin(sql);
} catch (err) {
  console.error(`migrate: failed — ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

async function seedFirstAdmin(sql) {
  const adminEmail = process.env.DRIFT_ADMIN_EMAIL;
  if (!adminEmail) {
    console.log('migrate: DRIFT_ADMIN_EMAIL not set — skipping first-admin seed.');
    return;
  }

  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users`;
  if (count > 0) {
    console.log(`migrate: ${count} user(s) already exist — skipping seed.`);
    return;
  }

  const { randomUUID, randomBytes } = await import('node:crypto');
  const bcryptMod = await import('bcryptjs');
  const bcrypt = bcryptMod.default ?? bcryptMod;

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randString = (n) => {
    const buf = randomBytes(n);
    let out = '';
    for (let i = 0; i < n; i += 1) out += ALPHABET[buf[i] % ALPHABET.length];
    return out;
  };
  const prefix = randString(8);
  const secret = randString(32);
  const plaintext = `drift_${prefix}_${secret}`;
  const hash = await bcrypt.hash(`${prefix}:${secret}`, 10);
  const userId = randomUUID();
  const tokenId = randomUUID();
  const adminScopes = JSON.stringify(['runs:read', 'runs:write', 'tokens:manage', 'audit:read']);

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO users (id, email, role)
      VALUES (${userId}, ${adminEmail}, 'admin')
    `;
    await tx`
      INSERT INTO api_tokens (id, user_id, name, prefix, hash, scopes)
      VALUES (${tokenId}, ${userId}, 'bootstrap', ${prefix}, ${hash}, ${adminScopes}::jsonb)
    `;
  });

  console.log('');
  console.log('================================================================');
  console.log(' drift-ci: bootstrap admin created');
  console.log('================================================================');
  console.log(`  email: ${adminEmail}`);
  console.log(`  token: ${plaintext}`);
  console.log('');
  console.log('  This is the only time the token is shown. Save it now.');
  console.log('  Configure clients with:  Authorization: Bearer <token>');
  console.log('================================================================');
  console.log('');
}
