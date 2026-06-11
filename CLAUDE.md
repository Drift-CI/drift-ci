# CLAUDE.md

Guidance for Claude Code (and human contributors) working in this repository.

## What this repo is

**drift-ci** — behaviour-regression testing for LLM applications, as a CI-time gate. Define cases with expected outputs, score them against a provider on every PR, and fail the build when behaviour drifts past a threshold; baselines are committed as code. It ships as a CLI, a GitHub Action, and a self-hostable dashboard, and is published (npm `@drift-ci/core` + `@drift-ci/cli`, the GitHub Marketplace, and the floating `Drift-CI/drift-ci@v1` action tag).

The architecture doc is the source of truth for *what* is built and *why*: [docs/drift-ci-architecture.md](docs/drift-ci-architecture.md). **When the doc and the code disagree, the code is reality** (e.g. the dashboard auth is hand-rolled, not NextAuth as the doc names).

## Stack & layout

- **pnpm 11 workspaces + Turborepo** monorepo; four packages under `packages/`: `core`, `cli`, `action`, `dashboard`.
- **TypeScript** strict, `module: NodeNext`. **Node ≥ 22** — Node 20 support was dropped (pnpm 11.5.3 requires Node ≥ 22.13).
- **Vitest** for tests.
- Dashboard: **Next.js 15 + Drizzle ORM + `postgres`**. Auth is **hand-rolled** — an HMAC-signed-cookie session (`lib/session.ts`, `lib/auth.ts`), custom GitHub/Google OAuth (`lib/oauth.ts`, `lib/google-oauth.ts`), and `bcryptjs`-hashed API tokens. There is **no NextAuth**, despite the architecture doc naming it.
- Action: bundled by **`@vercel/ncc`** into a single committed `packages/action/dist/index.js`.

## Commands

Turborepo-driven, from the repo root:

```bash
pnpm build       # pnpm -r build
pnpm test        # full Vitest suite across all packages
pnpm typecheck   # dashboard tsc (other packages typecheck during build)
pnpm dev
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on Node 22 + pnpm 11.5.3 and gates on `pnpm -r build`, dashboard `typecheck`, `pnpm test:coverage` (coverage thresholds: core ≥ 90 %, cli ≥ 80 %), and a `check-action-bundle` drift check.

- **`pnpm lint` is not wired into CI.** The dashboard's deprecated `next lint` is unconfigured and exits non-zero by going interactive — do not treat a `lint` failure as a regression. Verify dashboard work with build + typecheck + test.
- **pnpm 11 build approval lives in `pnpm-workspace.yaml` under `allowBuilds`** (pnpm 11 removed `onlyBuiltDependencies`). `sharp` MUST stay `false` there — approving it makes ncc bundle platform-specific native binaries into the committed Action `dist`.

## Non-Obvious Invariants

These are easy to get wrong and are already decided. If a change appears to contradict one of these, it is almost certainly a bug, not a design evolution:

- **Baselines are git-committed JSON files at `.drift/baseline/<case-id>.json`, not database rows.** There is no "promote baseline" endpoint or UI. The intentional-change flow is: run → inspect diff → `drift-ci baseline accept` → commit the baseline in the same PR as the code change. (arch §6, §16, §19)
- **The GitHub Action is native Node.js (`using: node20`), not Docker.** The single-file bundle at `packages/action/dist/index.js` is built with `@vercel/ncc` and **committed to the repo** — a CI job fails if it drifts from source. (arch §8, §26)
- **Storage adapters stay out of the Action bundle.** `SQLiteStorage` and `PostgresStorage` are optional peer deps loaded via dynamic `import()` (with a `webpackIgnore` hint), never statically bundled — the ncc Action bundle must stay portable. `HttpStorage` is the Action's sync path to the dashboard receiver; the Action falls back to `MemoryStorage` when no `dashboard-url` is configured. (arch §11, §12)
- **Transient provider errors are not regressions.** Rate-limits, network errors, auth errors, and timeouts map to `CaseStatus` values distinct from `pass`; the circuit breaker aborts the run with exit code 2 (`RUN_ABORTED_TRANSIENT`) when > `max(3, 20%)` of cases fail transiently. A regression is exit code 1; a transient storm is exit code 2. (arch §6)
- **`computeDeltas` treats NaN current scores as `NO_SCORE`, never `REGRESSION`.** Evaluator errors must never look like behaviour regressions. (arch §6, §26)
- **The `mock` provider is gated by `DRIFT_ENABLE_MOCK_PROVIDER=true` in the factory.** Production builds throw if the flag is unset. Tests must set it explicitly. (arch §11, §26)
- **Suite YAML has mutual-exclusion refinements:** a case has `input` XOR `messages`; a case using the `json-schema` evaluator must define `schema`; case IDs are unique within a suite. Enforced by the Zod schema, not by runtime checks downstream. (arch §25)
- **LLM-judge evaluators fence user content with a random per-call delimiter (`drift_<hex>`) and require a distinct `judgeProvider` from the test provider** unless `allowSelfBias: true` is set explicitly. (arch §10)
- **Secret redaction runs before baselines are persisted.** Regex scanners for AWS, Anthropic, OpenAI, JWT, and RSA keys replace matches with `[REDACTED:<kind>]`. Baselines are committed to git — nothing sensitive may ever reach disk. (arch §6)
- **`judgeHash` is distinct from `suiteHash`.** Judge-provider swaps emit a `stale-judge` warning but are not regressions. Re-baseline when the swap is intentional. `suiteHash` input is unchanged (input + expected + criteria + evaluators + threshold); `judgeHash = sha256(providerName + ':' + model + ':' + promptTemplate)`. (arch §6, v1.3 D1)
- **Baseline redaction metadata is counts-only.** The `redactions: [{ kind, count }][]` field records kind and count, never positions or partial values. The scan is authoritative — if it ran and returned empty, absence of the field is the record. (arch §6, v1.3 D3)
- **Config versioning is `MAJOR.MINOR`.** Minor bumps auto-upgrade in memory with a notice; major bumps require `drift-ci config migrate`. Unknown future versions hard-error with an upgrade hint. (arch §23, v1.3 D2)

## Releases & the Action bundle

- Releases run via **release-please** ([.github/workflows/release.yml](.github/workflows/release.yml)) from Conventional Commits. **Keep `separate-pull-requests: true`** — the grouped (`false`) mode deadlocks release-please's tagging after merge. A `core` release cascades to `cli`/`action`/`dashboard` via the node-workspace plugin; merge the `core` PR first, and resolve `.release-please-manifest.json` conflicts by writing the file explicitly (git can silently mis-merge a version line). See [docs/RELEASING.md](docs/RELEASING.md).
- npm publishing is **tokenless via OIDC Trusted Publishing** (requires pnpm 11.5+ and Node ≥ 22.13, and no setup-node `registry-url` to shadow the OIDC exchange).
- **`action.yml` lives at the repository ROOT**, not in `packages/action/` — GitHub Marketplace and the `Drift-CI/drift-ci@v1` reference only resolve a *root* `action.yml`; its `runs.main` points back at `packages/action/dist/index.js`.
- **The committed Action bundle must be built on Linux** (Node 22 + pnpm 11.5.3). ncc/webpack assigns different internal module IDs on Windows vs Linux, so a Windows-built bundle fails the `check-action-bundle` byte-check. Rebuild it in a `node:22-bookworm` container (or WSL) before committing.

## Editing the architecture doc

- The architecture doc is **stable** — only edit it when a design decision genuinely changes. Cross-references (`see arch §6`) point at section numbers, so **never renumber an existing section** — add a new one at the end or edit in place. Architecture §27 ("Claude Code Implementation Notes") is written for future Claude instances — read it before writing engine code.
- If a design decision genuinely changes, append an entry to the v1.x changelog at the end of the doc and bump the footer version.
- Baselines-are-files, transient-is-not-regression, and action-is-native-Node-not-Docker are load-bearing decisions — challenge any edit that weakens them.
