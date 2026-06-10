#!/usr/bin/env node
// Retention sweep — deletes runs older than `started_at + retention_days`
// (each row carries its own retention so different suites can opt into
// different histories). Idempotent.
//
// Wire into a scheduler:
//   * cron / systemd timer:    crontab "0 3 * * *  node scripts/retention.mjs"
//   * Kubernetes:                CronJob, schedule "0 3 * * *", same image
//   * Docker Compose:            see comment block in docker-compose.yml
//
// Exit codes:
//   0  sweep ran (any number deleted, including zero)
//   1  DATABASE_URL missing or DB error
//
// Operators see results in the audit log under `retention.swept`.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('retention: DATABASE_URL is required.');
  process.exit(1);
}

const batchLimit = Number.parseInt(
  process.env.DRIFT_RETENTION_BATCH_LIMIT ?? '10000',
  10,
);

const sql = postgres(databaseUrl, { max: 1 });

try {
  const start = Date.now();
  // Mirror the same SQL the in-process helper uses so a refactor here
  // shows up clearly in `git diff` against `lib/retention.ts`.
  const deleted = await sql`
    WITH expired AS (
      SELECT id FROM runs
      WHERE started_at + make_interval(days => retention_days) < now()
      ORDER BY started_at ASC
      LIMIT ${batchLimit}
    )
    DELETE FROM runs
    WHERE id IN (SELECT id FROM expired)
    RETURNING id
  `;
  const durationMs = Date.now() - start;
  const runsDeleted = deleted.length;

  // Audit row mirrors the lib helper. We could call into the helper
  // here, but staying self-contained keeps this script useful as a
  // last-resort during incident response (no module graph to load).
  const id = (await import('node:crypto')).randomUUID();
  await sql`
    INSERT INTO audit_events (id, kind, target, data)
    VALUES (
      ${id},
      'retention.swept',
      NULL,
      ${JSON.stringify({ runsDeleted, durationMs, batchLimit, via: 'cron' })}::jsonb
    )
  `;

  console.log(
    `retention: deleted ${runsDeleted} run(s) in ${durationMs} ms (batch limit ${batchLimit}).`,
  );
} catch (err) {
  console.error(
    `retention: failed — ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

void __dirname; // keep linters happy when this file is unused as a module
void join;
