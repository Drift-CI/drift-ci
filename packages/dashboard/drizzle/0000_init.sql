-- drift-ci dashboard initial schema.
--
-- Two tables to start: runs (the RunResult envelope the receiver ingests)
-- and baseline_snapshots (the immutable per-case ledger that drives the
-- drift timeline chart). Later milestones add users / api_tokens /
-- alert_rules / alert_events on top.

CREATE TABLE IF NOT EXISTS "runs" (
  "id"             uuid PRIMARY KEY,
  "suite_id"       text NOT NULL,
  "provider"       text NOT NULL,
  "started_at"     timestamptz NOT NULL,
  "completed_at"   timestamptz NOT NULL,
  "received_at"    timestamptz NOT NULL DEFAULT now(),
  "retention_days" integer NOT NULL DEFAULT 30,
  "data"           jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_runs_suite"   ON "runs" ("suite_id");
CREATE INDEX IF NOT EXISTS "idx_runs_started" ON "runs" ("started_at" DESC);

CREATE TABLE IF NOT EXISTS "baseline_snapshots" (
  "case_id"     text NOT NULL,
  "run_id"      uuid NOT NULL,
  "suite_hash"  text NOT NULL,
  "judge_hash"  text,
  "score"       double precision NOT NULL,
  "redactions"  jsonb,
  "captured_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("case_id", "run_id")
);

CREATE INDEX IF NOT EXISTS "idx_baseline_snapshots_case"
  ON "baseline_snapshots" ("case_id", "captured_at" DESC);

-- arch §18, v1.3 D3: baseline_snapshots are write-once. Reject UPDATEs at
-- the DB level so a mis-written ingest path can't silently mutate history.
-- DELETE is still allowed — the retention cron never deletes snapshots
-- (only runs), but ops might need to purge specific PII reports.

CREATE OR REPLACE FUNCTION reject_baseline_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'baseline_snapshots rows are immutable (attempted UPDATE on (case_id=%, run_id=%))',
    OLD.case_id, OLD.run_id
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS "baseline_snapshots_no_update" ON "baseline_snapshots";
CREATE TRIGGER "baseline_snapshots_no_update"
  BEFORE UPDATE ON "baseline_snapshots"
  FOR EACH ROW EXECUTE FUNCTION reject_baseline_snapshot_update();
