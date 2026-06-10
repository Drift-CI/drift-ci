-- M20a: per-user API tokens.
--
-- Replaces the bootstrap `DRIFT_INGEST_TOKEN` env-var auth from M18
-- with a real users + tokens model. Tokens are stored as
-- `bcrypt(prefix || ':' || secret)`, with the lookup keyed by an
-- 8-char `prefix` so we can find the right row before doing the
-- ~80 ms bcrypt compare.

CREATE TABLE IF NOT EXISTS "users" (
  "id"         uuid PRIMARY KEY,
  "email"      text NOT NULL UNIQUE,
  "name"       text,
  "role"       text NOT NULL CHECK ("role" IN ('admin', 'member', 'viewer')),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_users_role" ON "users" ("role");

CREATE TABLE IF NOT EXISTS "api_tokens" (
  "id"            uuid PRIMARY KEY,
  "user_id"       uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "name"          text NOT NULL,
  -- 8-char random alphanumeric, indexed for O(1) lookup.
  "prefix"        text NOT NULL UNIQUE,
  -- bcrypt hash of `<prefix>:<secret>` (the on-the-wire `Authorization`
  -- value, minus the "Bearer " scheme). Cost factor 10 by default.
  "hash"          text NOT NULL,
  "scopes"        jsonb NOT NULL,        -- e.g. ["runs:read", "runs:write"]
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "expires_at"    timestamptz,
  "last_used_at"  timestamptz,
  "revoked_at"    timestamptz
);

CREATE INDEX IF NOT EXISTS "idx_api_tokens_prefix" ON "api_tokens" ("prefix");
CREATE INDEX IF NOT EXISTS "idx_api_tokens_user"   ON "api_tokens" ("user_id");
