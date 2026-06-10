-- M26: alert rules + alert events.
--
-- Implements the schema half of the Phase 4 alert pipeline (arch §14,
-- §18). The router lands in M27; this migration just sets up the
-- tables it'll write to.
--
-- Two tables:
--
-- 1. alert_rules — durable per-team configuration. Persisted via the
--    /admin/alerts UI in M32. Suite-id is a soft reference (string,
--    not FK) so a run for a suite that has no rules ingests fine,
--    and a rule for a suite that hasn't been seen yet doesn't lose
--    its config when the next run finally arrives.
--
-- 2. alert_events — append-only ledger of every fire. Cascade-deleted
--    with the run that triggered it (the v1.3 B14 invariant: "runs
--    deletes alert_events; alert_rules survive"). Per-channel delivery
--    outcomes live in `deliveries` jsonb so a webhook 5xx and a Slack
--    200 are visible side-by-side without a second table.
--
-- Dedupe key is (rule_id, run_id) — enforced as UNIQUE so a buggy
-- router can't fire the same rule twice for the same run even if its
-- in-memory dedupe map is wrong (arch §14, §26).

CREATE TABLE IF NOT EXISTS "alert_rules" (
  "id"              uuid PRIMARY KEY,
  "name"            text NOT NULL,
  -- Soft suite reference — string only, no FK. NULL means "all suites".
  "suite_id"        text,
  "trigger"         jsonb NOT NULL,
  "channels"        jsonb NOT NULL,
  "enabled"         boolean NOT NULL DEFAULT true,
  "cooldown_minutes" integer NOT NULL DEFAULT 0
    CHECK ("cooldown_minutes" >= 0 AND "cooldown_minutes" <= 10080),
  "created_by"      uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_alert_rules_suite"
  ON "alert_rules" ("suite_id") WHERE "suite_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_alert_rules_enabled"
  ON "alert_rules" ("enabled") WHERE "enabled" = true;

CREATE TABLE IF NOT EXISTS "alert_events" (
  "id"          uuid PRIMARY KEY,
  -- Cascade so deleting a rule wipes its history. Operators reset state
  -- by deleting + recreating the rule when they intentionally want a
  -- clean slate; the audit log keeps the deletion visible.
  "rule_id"     uuid NOT NULL
    REFERENCES "alert_rules" ("id") ON DELETE CASCADE,
  -- Cascade with run retention. v1.3 B14: when a run is dropped by
  -- the retention sweep, its alert_events go too (alert_rules survive).
  "run_id"      uuid NOT NULL
    REFERENCES "runs" ("id") ON DELETE CASCADE,
  "reason"      text NOT NULL,
  "payload"     jsonb NOT NULL,
  -- Array of { type, status, error?, durationMs? } — populated by the
  -- senders. The router writes the row with empty deliveries first and
  -- updates once each sender completes.
  "deliveries"  jsonb NOT NULL DEFAULT '[]'::jsonb,
  "fired_at"    timestamptz NOT NULL DEFAULT now(),
  -- A rule fires at most once per run. The router enforces this in
  -- memory; the unique constraint is a safety net for double-fire
  -- bugs and concurrent ingest paths.
  CONSTRAINT "alert_events_rule_run_unique" UNIQUE ("rule_id", "run_id")
);

CREATE INDEX IF NOT EXISTS "idx_alert_events_rule"
  ON "alert_events" ("rule_id", "fired_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_alert_events_run"
  ON "alert_events" ("run_id");
CREATE INDEX IF NOT EXISTS "idx_alert_events_fired"
  ON "alert_events" ("fired_at" DESC);
