-- M21a: audit log.
--
-- Append-only ledger of security-sensitive events. The dashboard
-- admin UI surfaces this at /admin/audit. Other features will read
-- it too: M22 will record retention sweeps; M21b will record OAuth
-- handshakes.

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id"          uuid PRIMARY KEY,
  -- Nullable: bootstrap principal + system events (retention cron)
  -- have no user_id. We deliberately do NOT cascade on user delete
  -- — the audit row outlives the user it referenced (audit value).
  "user_id"     uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  -- Same reasoning for tokens — revoking is fine, the row stays.
  "token_id"    uuid REFERENCES "api_tokens" ("id") ON DELETE SET NULL,
  -- Stable kind string, e.g. 'user.signed-in' / 'token.minted' /
  -- 'token.revoked' / 'run.ingested' / 'auth.failed'.
  "kind"        text NOT NULL,
  -- Free-form reference: the affected token id, run id, etc.
  "target"      text,
  -- Bounded jsonb blob. Used for IP, user agent, error codes, etc.
  -- Keep small — no PII beyond what's necessary.
  "data"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_audit_events_occurred"
  ON "audit_events" ("occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_events_kind"
  ON "audit_events" ("kind", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_events_user"
  ON "audit_events" ("user_id", "occurred_at" DESC);
