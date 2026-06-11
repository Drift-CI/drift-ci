# Self-hosting drift-ci

This guide walks a team from "no infrastructure" to a running drift-ci
dashboard in roughly 30 minutes. It covers the canonical Docker Compose
deployment that ships with the repo. For TLS, custom domains, and
production reverse-proxy hardening, read [reverse-proxy.md](./reverse-proxy.md)
afterwards.

## What you get

- The Next.js dashboard at `http://localhost:3000` (or your reverse-proxy
  URL) with run history, drift timelines, and case-detail diffs.
- A Postgres 16 database holding runs, baseline snapshots, audit events,
  and API tokens.
- A retention sidecar that sweeps expired runs at 03:00 UTC daily.
- One admin user, one bootstrap API token, and the handful of env vars
  you need to point your CI workflows at the dashboard.

The committed baselines under `.drift/baseline/` stay in your repo —
the dashboard never owns the source of truth for "what should the score
be." It owns history and visibility. (See arch §6 / §16 / §19.)

## Prerequisites

- Docker 24+ and Docker Compose v2 (the modern `docker compose` plugin,
  not the legacy `docker-compose` Python script).
- A reachable hostname if you want GitHub OAuth or webhooks. For local
  evaluation, `localhost:3000` is fine.
- ~1 GB of disk for Postgres. Run-row footprint scales with case count
  × runs retained (default 90 days).

## 1. Clone the repo

```bash
git clone https://github.com/Drift-CI/drift-ci.git
cd drift-ci/packages/dashboard
```

The `docker-compose.yml` lives next to the `Dockerfile` and is the
intended entry point. Building from the repo root would also work but
the compose file already references `context: ../..` for you.

## 2. Set the required env vars

Create a `.env` file next to `docker-compose.yml`:

```bash
# Required
DRIFT_SESSION_SECRET=$(openssl rand -hex 32)
DRIFT_ADMIN_EMAIL=you@example.com

# Required for ingest-only bootstrap (refused once a real admin exists)
DRIFT_INGEST_TOKEN=$(openssl rand -hex 32)

# Optional — GitHub OAuth (recommended over the password fallback)
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=

# Optional — Google OAuth (works alongside or instead of GitHub)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=

# Optional — webhook receiver (HMAC-verified; see step 8)
GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)

# Optional — retention sweep batch size (default 10000)
DRIFT_RETENTION_BATCH_LIMIT=10000
```

Compose loads `.env` automatically. **Do not commit it.** A
`.env.example` would be a fine pattern to crib from later.

### What each variable does

| Variable | Required? | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes (compose sets it) | Postgres connection string. Compose injects `postgres://drift:drift@postgres:5432/drift_ci`. Override only if you point at an external Postgres. |
| `DRIFT_SESSION_SECRET` | **yes** | HMAC key for the signed-cookie session and OAuth state. Rotating it invalidates every session — desired for incident response. |
| `DRIFT_ADMIN_EMAIL` | yes (first run) | Email seeded as the first admin user. The migration script prints a one-time bootstrap API token to stdout the first time it runs with no users in the DB. |
| `DRIFT_INGEST_TOKEN` | optional | Legacy bearer token honoured **only when zero users exist**. Lets a CI workflow ingest runs before you've signed in to mint a real token. Refused once a user exists. |
| `DRIFT_DASHBOARD_PASSWORD` | optional | If set, enables a password fallback on the login page. Mostly useful for offline / no-OAuth setups. |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | optional | Enables the "Sign in with GitHub" button. See [GitHub OAuth setup](#6-optional-github-oauth-setup) below. |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | optional | Enables the "Sign in with Google" button. Both providers can be enabled at once. See [Google OAuth setup](#7-optional-google-oauth-setup) below. |
| `DRIFT_GOOGLE_OAUTH_REDIRECT_URI` | optional | Same role as `DRIFT_OAUTH_REDIRECT_URI` but for the Google flow — overrides the callback URL when running behind a reverse proxy. |
| `DRIFT_OAUTH_REDIRECT_URI` | optional | Override the OAuth callback URL drift-ci hands to GitHub. Set this when running behind a reverse proxy where `request.url` doesn't reflect the public URL — see [reverse-proxy.md](./reverse-proxy.md). |
| `GITHUB_WEBHOOK_SECRET` | optional | HMAC key for the `POST /api/v1/webhooks/github` receiver. Closed-by-default (`503`) when unset — set it before pointing GitHub at the endpoint. |
| `DRIFT_RETENTION_BATCH_LIMIT` | optional | Cap on rows deleted per sweep (default 10000). Larger values can hold a write lock longer; smaller values just mean more sweeps catch up over time. |

## 3. Bring it up

```bash
docker compose up -d
docker compose logs -f dashboard
```

The dashboard container does three things on start, in order:

1. Applies every SQL file under `packages/dashboard/drizzle/` against
   `DATABASE_URL`, idempotent via the `schema_migrations` ledger.
2. Seeds the first admin user when the table is empty AND
   `DRIFT_ADMIN_EMAIL` is set, and prints **one** plaintext bootstrap
   token like:
   ```
   drift-ci: bootstrap admin token (save this — shown only once):
     drift_a1b2c3d4_<32 chars>
   ```
3. Boots Next.js on port 3000.

Save the bootstrap token somewhere safe. The dashboard never displays
it again — that's what `/admin/tokens` is for once you're signed in.

If the seed step exits without printing a token, a user already exists
in the table; sign in with that account and mint a fresh token instead.

## 4. Sign in

Open `http://localhost:3000/login` and either:

- Click **Sign in with GitHub** (if you set the OAuth client env vars).
  GitHub returns to the callback, drift-ci verifies your verified email
  exists in the `users` table, and signs you in.
- Or use the password fallback (if you set `DRIFT_DASHBOARD_PASSWORD`).

There is **no JIT user creation** — a hostile GitHub account can't
sign in just because OAuth is enabled. There is no self-serve sign-up;
add new users by inserting a row into `users` with the same email as
the verified GitHub email.

## 5. Point CI at the dashboard

Mint an API token at `/admin/tokens` (or use the bootstrap token from
step 3, but that token is admin-scoped and worth rotating soon).

In your `.drift/config.yaml`:

```yaml
storage:
  type: http
  url: https://drift.example.com  # or http://localhost:3000 for local
  # token can also come from DRIFT_INGEST_TOKEN env var at run time
```

In your CI workflow:

```yaml
- uses: Drift-CI/drift-ci@v1
  with:
    provider: anthropic
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    dashboard-url: https://drift.example.com
    dashboard-token: ${{ secrets.DRIFT_DASHBOARD_TOKEN }}
```

The action POSTs each completed run to `POST /api/v1/runs` and inserts
one `baseline_snapshots` row per case. The drift timeline on the
case-detail page is fed by those snapshot rows — they outlive run
retention by design (no FK from snapshots to runs).

If the dashboard is unreachable, the action surfaces a warning and
the build still passes or fails based on the local regression check —
an offline dashboard never blocks a PR.

## 6. (Optional) GitHub OAuth setup

1. Visit https://github.com/settings/applications/new (or your GitHub
   org's OAuth Apps page).
2. **Homepage URL:** `https://drift.example.com`
3. **Authorization callback URL:** `https://drift.example.com/login/github/callback`
4. Copy the **Client ID** into `GITHUB_OAUTH_CLIENT_ID` and the
   **Client secret** into `GITHUB_OAUTH_CLIENT_SECRET` in your `.env`.
5. `docker compose up -d` to pick up the new env. The login page now
   shows the GitHub button.

If your reverse proxy means `request.url` inside the container doesn't
reflect the public URL (the common case), set
`DRIFT_OAUTH_REDIRECT_URI=https://drift.example.com/login/github/callback`
explicitly. See [reverse-proxy.md](./reverse-proxy.md#oauth-and-redirect-uris).

## 7. (Optional) Google OAuth setup

drift-ci can sign users in via Google as well as (or instead of) GitHub.
Both buttons appear on the login page when both client-id env vars are
set; users pick whichever they prefer.

1. Visit the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. **Create OAuth client ID** → Application type: **Web application**.
3. **Authorised redirect URIs:** `https://drift.example.com/login/google/callback`
4. Copy the **Client ID** into `GOOGLE_OAUTH_CLIENT_ID` and the
   **Client secret** into `GOOGLE_OAUTH_CLIENT_SECRET` in your `.env`.
5. `docker compose up -d` to pick up the new env. The login page now
   shows the Google button.

drift-ci requests `openid email profile` and **rejects accounts whose
`email_verified` flag is false** — a Google account that hasn't
proven control of its email cannot claim a local user with that
address. The local `users` table still gates sign-in: there is no
JIT user creation, so a Google account whose verified email isn't
already in the DB sees an "email isn't in users" error.

For reverse-proxy deployments, set
`DRIFT_GOOGLE_OAUTH_REDIRECT_URI=https://drift.example.com/login/google/callback`
to override the container-local callback URL — same role as
`DRIFT_OAUTH_REDIRECT_URI` plays for the GitHub flow. See
[reverse-proxy.md](./reverse-proxy.md#oauth-and-redirect-uris).

## 8. (Optional) Webhook receiver

The `POST /api/v1/webhooks/github` endpoint verifies the
`X-Hub-Signature-256` HMAC, records every delivery in the audit log,
and returns 200.

To turn it on now:

1. Set `GITHUB_WEBHOOK_SECRET` in `.env` and restart.
2. In the GitHub repo (or org) **Settings → Webhooks → Add webhook**:
   - **Payload URL:** `https://drift.example.com/api/v1/webhooks/github`
   - **Content type:** `application/json`
   - **Secret:** the same `GITHUB_WEBHOOK_SECRET` value.
3. Pick the events you care about and save.

Until the secret is set, the endpoint returns `503 service unavailable`
to every request — closed-by-default.

## 9. Retention

The `retention` service in `docker-compose.yml` runs the standalone
`scripts/retention.mjs` daily at 03:00 UTC. Every sweep — even a
no-op — writes a `retention.swept` row to the audit log with
`runsDeleted` and `durationMs`, so the `/admin/audit` page makes it
visible whether the cron is firing.

To trigger a sweep manually (e.g., to clear old test data):

```bash
docker compose exec dashboard node packages/dashboard/scripts/retention.mjs
```

To disable the cron entirely, comment out the `retention` service in
`docker-compose.yml` and run the same script externally (k8s CronJob,
host crontab, etc.).

## Backups

Postgres data lives in the named volume `drift-ci-pg-data`. Two
strategies that work:

- **Volume snapshots** — fine for VMs / cloud disks if you can pause
  writes briefly. `docker compose stop dashboard retention`, snapshot,
  start back up.
- **`pg_dump` from inside the postgres container** — works hot:

  ```bash
  docker compose exec postgres \
    pg_dump -U drift -d drift_ci -F c -f /var/lib/postgresql/data/backup.dump
  docker compose cp postgres:/var/lib/postgresql/data/backup.dump ./backup.dump
  ```

Restore with `pg_restore -U drift -d drift_ci /path/to/backup.dump`.

The committed baselines are the source of truth for expected
behaviour, so a destroyed dashboard DB doesn't silently change CI
verdicts — the next run rebuilds run history from scratch and the
PR check still gates on the same baselines.

## Upgrades

```bash
git pull
docker compose build dashboard
docker compose up -d
```

The migration script applies any new SQL files in `drizzle/` under a
`schema_migrations` ledger before the server starts. A failed
migration exits non-zero and the container fails fast — the old
container keeps serving in the meantime.

For zero-downtime upgrades behind a reverse proxy, run two dashboard
replicas; the migration script is safe under concurrent runs (each
file's apply is gated by an advisory lock).

## What's next

- [reverse-proxy.md](./reverse-proxy.md) — TLS, custom domain, and the
  `X-Forwarded-*` headers drift-ci needs to behave correctly behind
  nginx / Caddy / Traefik.
- [drift-ci-architecture.md](./drift-ci-architecture.md) §16 — the
  full RBAC, audit, and rate-limit design if you want to extend the
  dashboard.
