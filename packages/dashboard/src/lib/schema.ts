import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// ─── auth (M20) ───────────────────────────────────────────────────────────
// Per-user identity + bcrypt-hashed API tokens. The token model uses an
// 8-char prefix as the lookup key so we can find the row before paying
// the ~80 ms bcrypt-compare cost.

export type UserRole = 'admin' | 'member' | 'viewer';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull().unique(),
    name: text('name'),
    // CHECK constraint lives at the DB layer; the $type<UserRole>() cast
    // keeps TS queries narrow without an enum migration.
    role: text('role').$type<UserRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    roleIdx: index('idx_users_role').on(table.role),
  }),
);

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull().unique(),
    hash: text('hash').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => ({
    prefixIdx: index('idx_api_tokens_prefix').on(table.prefix),
    userIdx: index('idx_api_tokens_user').on(table.userId),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;

// ─── audit (M21a) ─────────────────────────────────────────────────────────
// Append-only ledger of security-sensitive events. user_id and token_id
// are SET NULL on cascade so the audit trail outlives the principals it
// references — see comment in 0002_audit.sql.

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    tokenId: uuid('token_id').references(() => apiTokens.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    target: text('target'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    occurredIdx: index('idx_audit_events_occurred').on(table.occurredAt.desc()),
    kindIdx: index('idx_audit_events_kind').on(table.kind, table.occurredAt.desc()),
    userIdx: index('idx_audit_events_user').on(table.userId, table.occurredAt.desc()),
  }),
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

// ─── runs ────────────────────────────────────────────────────────────────
// One row per drift-ci run — the receiver writes these from the CLI or the
// GitHub Action via HttpStorage. `data` holds the full serialised RunResult
// so the UI can render per-case detail without schema migrations every time
// core adds a field.
//
// retention_days drives the retention cron (see Phase 3 M22). Default 30d.

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey(),
    suiteId: text('suite_id').notNull(),
    provider: text('provider').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    retentionDays: integer('retention_days').notNull().default(30),
    data: jsonb('data').notNull(),
  },
  (table) => ({
    suiteIdx: index('idx_runs_suite').on(table.suiteId),
    startedIdx: index('idx_runs_started').on(table.startedAt.desc()),
  }),
);

// ─── baseline_snapshots ──────────────────────────────────────────────────
// Write-once ledger of per-case scores per run. Drives the dashboard's case
// drill-down (old → new output diff) and the drift timeline chart. Rows are
// immutable by design — see the UPDATE-rejecting trigger in the initial
// migration (arch §18, v1.3 D3).
//
// Deliberately NOT foreign-keyed to runs: the retention cron deletes old
// runs but preserves their snapshots as the historical record.

export const baselineSnapshots = pgTable(
  'baseline_snapshots',
  {
    caseId: text('case_id').notNull(),
    runId: uuid('run_id').notNull(),
    suiteHash: text('suite_hash').notNull(),
    judgeHash: text('judge_hash'),
    score: doublePrecision('score').notNull(),
    redactions: jsonb('redactions'),
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.caseId, table.runId] }),
    caseIdx: index('idx_baseline_snapshots_case').on(table.caseId, table.capturedAt.desc()),
  }),
);

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type BaselineSnapshot = typeof baselineSnapshots.$inferSelect;
export type NewBaselineSnapshot = typeof baselineSnapshots.$inferInsert;

// ─── alerts (M26) ────────────────────────────────────────────────────────
// Phase 4 alert pipeline: rules are durable per-team config; events are
// append-only fires with per-channel delivery outcomes embedded in jsonb.
//
// `suite_id` on alert_rules is a soft reference (string, no FK) so a rule
// can be configured before its target suite has been seen by ingest.
//
// `run_id` on alert_events DOES have a FK with ON DELETE CASCADE — the
// retention cron deletes runs and we want their alert_events to go with
// them (alert_rules survive). v1.3 B14, arch §18.

export const alertRules = pgTable(
  'alert_rules',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    suiteId: text('suite_id'),
    trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull(),
    channels: jsonb('channels').$type<Array<Record<string, unknown>>>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    cooldownMinutes: integer('cooldown_minutes').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    suiteIdx: index('idx_alert_rules_suite').on(table.suiteId),
    enabledIdx: index('idx_alert_rules_enabled').on(table.enabled),
  }),
);

export const alertEvents = pgTable(
  'alert_events',
  {
    id: uuid('id').primaryKey(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => alertRules.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    deliveries: jsonb('deliveries')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    firedAt: timestamp('fired_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Mirror of the SQL UNIQUE constraint — the router relies on this so
    // a double-fire concurrent insert raises rather than slipping through.
    ruleRunUnique: unique('alert_events_rule_run_unique').on(table.ruleId, table.runId),
    ruleIdx: index('idx_alert_events_rule').on(table.ruleId, table.firedAt.desc()),
    runIdx: index('idx_alert_events_run').on(table.runId),
    firedIdx: index('idx_alert_events_fired').on(table.firedAt.desc()),
  }),
);

export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;
export type AlertEvent = typeof alertEvents.$inferSelect;
export type NewAlertEvent = typeof alertEvents.$inferInsert;
