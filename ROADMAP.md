# Roadmap

drift-ci is approaching its first tagged release. The core engine, CLI,
GitHub Action, and self-hostable dashboard are feature-complete and covered by
tests; the remaining work before `v1.0.0` is hardening and release mechanics.

This is a high-level, capability-oriented view. For the *why* and the technical
detail behind each item, see [docs/drift-ci-architecture.md](docs/drift-ci-architecture.md).

## Shipped

**CLI & core engine**
- `drift-ci init` / `run` / `baseline init|accept|doctor|prune` / `compare` / `config migrate`
- Git-committed JSON baselines (`.drift/baseline/<case-id>.json`) with secret redaction before persistence
- Evaluators: exact-match, json-schema, cosine-similarity (embeddings), llm-judge, refusal-detection, rubric-checklist, safety-classifier
- Providers: Anthropic, OpenAI, Azure OpenAI, Bedrock (Anthropic), Google Gemini, Vertex AI, Ollama (local + cloud)
- Transient-error classification + circuit breaker (transient storms ≠ regressions)
- Reporters: terminal (Ink), plain text, JSON, JUnit XML
- Run-history storage adapters: memory, SQLite, Postgres, HTTP (dashboard sync)

**GitHub Action**
- Native Node 20 action with committed `@vercel/ncc` bundle
- Idempotent PR comment (regression/improvement tables, accept-regressions footer, stale-baseline warnings)
- Fork-PR safety gate, `baseline-source: branch|main`, JUnit output, optional dashboard sync

**Dashboard (self-hostable)**
- Next.js 15 + Postgres; run history, run detail, case old→new diff, drift timeline, provider comparison
- Hand-rolled session auth + GitHub/Google OAuth, bcrypt API tokens, RBAC (viewer/member/admin)
- Alert rules + Slack / Teams / PagerDuty / email / generic-HMAC-webhook senders
- Audit log, rate limiting, retention sweep, Docker Compose deployment

## In progress — toward v1.0.0

- First tagged release + npm publish + GitHub Marketplace listing
- Real-provider quick-start validation and external-adopter feedback

## Planned — hardening

- Threat-model document and external penetration test
- SBOM (SPDX) attached to releases; sigstore-signed artifacts; pinned action SHAs
- Opt-in anonymous telemetry (disabled by default and on CI)

Items are sequenced roughly in the order above; specifics may shift as the
project approaches release.
