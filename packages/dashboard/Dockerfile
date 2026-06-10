# drift-ci dashboard — multi-stage build.
#
# Stage 1 (builder) installs the full workspace and builds `core` then
# `dashboard`. We deliberately install the whole workspace rather than
# filtering — pnpm's strict hoisting puts tsc in `.pnpm/` and the
# `packages/core/node_modules/.bin/tsc` symlink doesn't survive a COPY
# across stages cleanly. Installing-then-building in one stage keeps
# the bin links intact at build time.
#
# Stage 2 (runner) is a minimal image that takes ONLY the Next.js
# `standalone` output (which already bundles its own production deps)
# plus static assets, migrations, and the migrate runner.

ARG NODE_VERSION=20-bookworm-slim

# ─── builder ──────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

RUN corepack enable

# Copy the full workspace. The Next standalone output below picks only
# the runtime deps it actually imports, so the size of this stage
# doesn't pollute the final image.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/dashboard/package.json ./packages/dashboard/

# Drop the workspace filter — pnpm's `--filter @drift-ci/dashboard...`
# treats `core` as a transitive runtime dep and skips its
# devDependencies (typescript, vitest, etc.), but core's `build` script
# needs tsc. Installing the full workspace is fine — the Next standalone
# output below picks only runtime deps so this doesn't bloat the image.
RUN pnpm install --frozen-lockfile

COPY packages/core ./packages/core
COPY packages/dashboard ./packages/dashboard

RUN pnpm --filter @drift-ci/core build \
 && pnpm --filter @drift-ci/dashboard build

# ─── runner ───────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 drift \
 && adduser --system --uid 1001 --ingroup drift drift

# Next.js standalone server + its deps.
COPY --from=builder --chown=drift:drift /app/packages/dashboard/.next/standalone ./
COPY --from=builder --chown=drift:drift /app/packages/dashboard/.next/static ./packages/dashboard/.next/static
COPY --from=builder --chown=drift:drift /app/packages/dashboard/public ./packages/dashboard/public

# Migrations + migrate runner — entrypoint applies them against
# DATABASE_URL before exec'ing the server.
COPY --from=builder --chown=drift:drift /app/packages/dashboard/drizzle ./packages/dashboard/drizzle
COPY --from=builder --chown=drift:drift /app/packages/dashboard/scripts ./packages/dashboard/scripts

# `scripts/migrate.mjs` does a dynamic `import('bcryptjs')` to hash the
# bootstrap token when seeding the first admin, plus `import postgres`
# at the top of the file. Next.js standalone only bundles deps reached
# from app code, not from scripts/, so we copy these two from the
# builder where the workspace install left them at
# `packages/dashboard/node_modules/`. Node's lookup walks up from
# `scripts/migrate.mjs` and finds them there.
COPY --from=builder --chown=drift:drift /app/packages/dashboard/node_modules/bcryptjs ./packages/dashboard/node_modules/bcryptjs
COPY --from=builder --chown=drift:drift /app/packages/dashboard/node_modules/postgres ./packages/dashboard/node_modules/postgres

USER drift

EXPOSE 3000

# Apply migrations then start the server. If DATABASE_URL is unreachable
# the migrate script exits non-zero and the container fails fast.
CMD ["sh", "-c", "node packages/dashboard/scripts/migrate.mjs && node packages/dashboard/server.js"]
