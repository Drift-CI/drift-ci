# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current Repo State

**Phases 1–4 are code-complete; Phase 5 has not started; nothing has been released yet.** The pnpm + Turborepo monorepo is built out under `packages/` (`core`, `cli`, `action`, `dashboard`) with 70+ Vitest test files. `pnpm build`, `pnpm typecheck`, and `pnpm test` are green.

"Code-complete but unreleased" means, concretely:

- There are **no git tags** — no `v1.0.0`, no npm publish, no Marketplace listing. Every phase's *exit gate* is still open, and the gates are human-gated (a timed real-API quick-start, a version tag cut, an external adopter reporting back), not more code. The active frontier is closing those gates and Phase 5 (hardening), which is not started.
- High-level status lives in [ROADMAP.md](ROADMAP.md); the granular delivery tracker is kept privately, outside the repo.

The architecture doc remains the source of truth and outranks any stale assumption here:

- [docs/drift-ci-architecture.md](docs/drift-ci-architecture.md) — canonical architecture reference (stable; *what* is built and *why*). Note: a few design intentions in it were not followed verbatim during implementation (e.g. the dashboard session is hand-rolled, not NextAuth — see Stack below); when the doc and the code disagree, the code is reality.
- [ROADMAP.md](ROADMAP.md) — high-level view of what's shipped and what's planned.

## Doc Roles

- **Architecture doc** describes *what* is being built and *why*. It is stable — only edit it when a design decision genuinely changes. Cross-references throughout the codebase point at its section numbers (e.g. "see arch §6"), so do not renumber sections.
- **Roadmap** ([ROADMAP.md](ROADMAP.md)) is the public, high-level view of what's shipped and what's planned. The detailed, mutable delivery tracker is kept private, outside the repo.

Architecture §27 ("Claude Code Implementation Notes") is written specifically for future Claude instances implementing this — read it before writing code.

## Stack (per architecture §5, §22, §23)

- pnpm workspaces + Turborepo monorepo; four packages under `packages/`: `core`, `cli`, `action`, `dashboard`.
- TypeScript strict, `module: NodeNext`, Node ≥ 20.
- Vitest for tests. ESLint for lint.
- Next.js 15 + Drizzle ORM + `postgres` for the dashboard. **Auth is hand-rolled** — an HMAC-signed-cookie session (`lib/session.ts`, `lib/auth.ts`) with custom GitHub/Google OAuth (`lib/oauth.ts`, `lib/google-oauth.ts`) and `bcryptjs`-hashed API tokens. There is **no NextAuth**, despite the architecture doc naming it.
- `@vercel/ncc` for the GitHub Action bundle.

Primary commands are Turborepo-driven: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm dev`. CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) gates on `pnpm -r build`, dashboard `typecheck`, `pnpm test:coverage` (coverage thresholds: core ≥ 90 %, cli ≥ 80 %), and an action-bundle drift check. **`pnpm lint` is not wired into CI** — the dashboard's deprecated `next lint` is unconfigured and exits non-zero by going interactive, so don't treat a `lint` failure as a regression; verify dashboard work with build + typecheck + test.

## Non-Obvious Invariants

These are easy to get wrong and are already decided. If a change appears to contradict one of these, it is almost certainly a bug, not a design evolution:

- **Baselines are git-committed JSON files at `.drift/baseline/<case-id>.json`, not database rows.** There is no "promote baseline" endpoint or UI. The intentional-change flow is: run → inspect diff → `drift-ci baseline accept` → commit the baseline in the same PR as the code change. (arch §6, §16, §19)
- **The GitHub Action is native Node.js (`using: node20`), not Docker.** The single-file bundle at `packages/action/dist/index.js` is built with `@vercel/ncc` and **committed to the repo** — a CI job fails if it drifts from source. (arch §8, §26)
- **Storage adapters stay out of the Action bundle.** `SQLiteStorage` and `PostgresStorage` are optional peer deps loaded via dynamic `import()` (with a `webpackIgnore` hint), never statically bundled — the ncc Action bundle must stay portable. `HttpStorage` (shipped in Phase 3) is the Action's sync path to the dashboard receiver; the Action falls back to `MemoryStorage` when no `dashboard-url` is configured. (arch §11, §12)
- **Transient provider errors are not regressions.** Rate-limits, network errors, auth errors, and timeouts map to `CaseStatus` values distinct from `pass`; the circuit breaker aborts the run with exit code 2 (`RUN_ABORTED_TRANSIENT`) when > `max(3, 20%)` of cases fail transiently. A regression is exit code 1; a transient storm is exit code 2. (arch §6)
- **`computeDeltas` treats NaN current scores as `NO_SCORE`, never `REGRESSION`.** Evaluator errors must never look like behaviour regressions. (arch §6, §26)
- **The `mock` provider is gated by `DRIFT_ENABLE_MOCK_PROVIDER=true` in the factory.** Production builds throw if the flag is unset. Tests must set it explicitly. (arch §11, §26)
- **Suite YAML has mutual-exclusion refinements:** a case has `input` XOR `messages`; a case using the `json-schema` evaluator must define `schema`; case IDs are unique within a suite. Enforced by the Zod schema, not by runtime checks downstream. (arch §25)
- **LLM-judge evaluators fence user content with a random per-call delimiter (`drift_<hex>`) and require a distinct `judgeProvider` from the test provider** unless `allowSelfBias: true` is set explicitly. (arch §10)
- **Secret redaction runs before baselines are persisted.** Regex scanners for AWS, Anthropic, OpenAI, JWT, and RSA keys replace matches with `[REDACTED:<kind>]`. Baselines are committed to git — nothing sensitive may ever reach disk. (arch §6)
- **`judgeHash` is distinct from `suiteHash`.** Judge-provider swaps emit a `stale-judge` warning but are not regressions. Re-baseline when the swap is intentional. `suiteHash` input is unchanged (input + expected + criteria + evaluators + threshold); `judgeHash = sha256(providerName + ':' + model + ':' + promptTemplate)`. (arch §6, v1.3 D1)
- **Baseline redaction metadata is counts-only.** The `redactions: [{ kind, count }][]` field records kind and count, never positions or partial values. The scan is authoritative — if it ran and returned empty, absence of the field is the record. (arch §6, v1.3 D3)
- **Config versioning is `MAJOR.MINOR`.** Minor bumps auto-upgrade in memory with a notice; major bumps require `drift-ci config migrate`. Unknown future versions hard-error with an upgrade hint. (arch §23, v1.3 D2)

## Phased Delivery Order

Phases are sequenced. Code for phases 1–4 has landed (exit gates not yet formally closed — see Current Repo State); phase 5 is the active frontier. At-a-glance, with status:

1. ✅ code-complete — **CLI + Single Provider** — Anthropic only, local SQLite, `FileBaselineStore`, core evaluators, OSS hygiene files.
2. ✅ code-complete — **CI Integration** — native Node20 GitHub Action, PR comment, OpenAI/Azure/Bedrock, LLM-judge, release-please.
3. ✅ code-complete — **Dashboard + Sync** — `HttpStorage`, Next.js dashboard, Postgres, RBAC, retention.
4. ✅ code-complete — **Alerts + Team Features** — alert router, Slack/Teams/PagerDuty, OAuth, rubric + safety evaluators.
5. ⬜ not started — **Hardening** — pentest, SBOM, sigstore, opt-in telemetry.

Per-phase capability detail lives in [ROADMAP.md](ROADMAP.md).

## When Editing the Architecture Doc

- Keep cross-references (§N) valid. Never renumber a section that already exists — add a new one at the end or edit in place.
- If a design decision genuinely changes, append an entry to the v1.x changelog at the end of the doc and bump the footer version.
- Baselines-are-files, transient-is-not-regression, and action-is-Node20 are load-bearing decisions — challenge any edit that weakens them.
