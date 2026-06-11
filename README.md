# drift-ci

[![CI](https://github.com/drift-ci/drift-ci/actions/workflows/ci.yml/badge.svg)](https://github.com/drift-ci/drift-ci/actions/workflows/ci.yml)
[![npm (@drift-ci/cli)](https://img.shields.io/npm/v/@drift-ci/cli?label=%40drift-ci%2Fcli)](https://www.npmjs.com/package/@drift-ci/cli)
[![npm (@drift-ci/core)](https://img.shields.io/npm/v/@drift-ci/core?label=%40drift-ci%2Fcore)](https://www.npmjs.com/package/@drift-ci/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Behaviour-regression testing for LLM applications. Define a suite of cases with
expected outputs, run them against your provider on every PR, and fail the
build if behaviour drifts beyond a configurable threshold.

drift-ci treats prompts the way you treat code: deterministic tests, committed
baselines, diff-style reports on pull requests.

## Status

drift-ci is feature-complete across the CLI, GitHub Action, and self-hostable
dashboard, and is approaching its first tagged release. See
[ROADMAP.md](ROADMAP.md) for what's shipped and what's planned.

**Shipped:**

- Providers: `anthropic`, `openai`, `azure` (Azure OpenAI), `bedrock`
  (Bedrock Anthropic), `ollama` (local + cloud), and a gated `mock`.
- Evaluators: `exact-match`, `json-schema`, `cosine-similarity` (embedding),
  `llm-judge`, `refusal-detection`.
- Baselines committed as JSON files under `.drift/baseline/` with per-case
  `suiteHash` / `judgeHash` / `redactions` metadata.
- Run history: `memory`, `json-file`, or `sqlite` storage.
- Reporters: Ink live terminal, plain text (pipe-safe), JSON, JUnit XML.
- `drift-ci config migrate` for cross-version config bumps.
- Native Node 20 GitHub Action with idempotent PR comments, JUnit
  output, fork-PR safety gate, and optional `baseline-source: main`.

## Install

drift-ci requires Node.js 20 or newer.

```bash
npm install --save-dev @drift-ci/cli
# or
pnpm add -D @drift-ci/cli
```

### GitHub Action

```yaml
- uses: drift-ci/drift-ci@v1
  with:
    provider: anthropic
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Full inputs/outputs and the `safe-to-run-llm-tests` fork workflow pattern
live in [packages/action/README.md](packages/action/README.md). Ready-made
example workflows (basic, matrix, fork-gated, GitLab CI) live under
[examples/workflows/](examples/workflows/).

## Quick start

```bash
# 1. Scaffold a .drift/config.yaml and .drift/suite.yaml
npx @drift-ci/cli init

# 2. Run the suite
npx @drift-ci/cli run

# 3. Inspect the diff, then accept intentional changes
npx @drift-ci/cli baseline accept
git add .drift/baseline && git commit -m "accept baseline updates"
```

A minimal `.drift/suite.yaml`:

```yaml
version: 1
id: greetings
name: Greetings
evaluators: [exact-match]
cases:
  - id: hello
    input: Say hi.
    expected: Hi!
```

## How it works

- **Run.** Each case is sent to the configured provider; the response is scored
  by the evaluator chain.
- **Compare.** Scores are compared to the committed baseline under
  `.drift/baseline/<case-id>.json`.
- **Decide.** A regression (score delta below the configured threshold) exits
  the CLI with code 1. A transient-error storm (rate limits, network, timeouts)
  exits with code 2 instead — never a regression.
- **Accept.** Intentional behaviour changes are promoted with
  `drift-ci baseline accept` and committed alongside the code change in the
  same PR.

## Non-obvious invariants

drift-ci makes a few load-bearing decisions worth knowing about:

- **Baselines are git-committed JSON files**, not database rows. There is no
  "promote" endpoint or UI — accept locally, commit, review as code.
- **Transient provider errors are not regressions.** Rate limits and network
  errors get dedicated `CaseStatus` values and never look like behaviour
  regressions.
- **The `mock` provider requires `DRIFT_ENABLE_MOCK_PROVIDER=true`.** It is
  disabled in production builds by default.
- **Secrets are redacted before baselines hit disk.** Baselines are committed
  to git — nothing sensitive may ever land on disk.

See [docs/drift-ci-architecture.md](docs/drift-ci-architecture.md) for the full
design rationale.

## Documentation

- [Architecture reference](docs/drift-ci-architecture.md) — what is being
  built and why.
- [Roadmap](ROADMAP.md) — what's shipped and what's planned.
- [Self-hosting guide](docs/self-hosting.md) — bring up the dashboard +
  Postgres with Docker Compose in ~30 minutes.
- [Reverse-proxy hardening](docs/reverse-proxy.md) — TLS, custom domain,
  and the `X-Forwarded-*` headers drift-ci needs behind nginx / Caddy /
  Traefik.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
development workflow, commit conventions, and DCO sign-off requirements.

## Security

To report a vulnerability, please follow the process in
[SECURITY.md](SECURITY.md). Do not open public GitHub issues for security
reports.

## License

drift-ci is released under the [MIT License](LICENSE).
