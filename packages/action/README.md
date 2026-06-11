# drift-ci GitHub Action

Behaviour regression testing for LLM applications, as a merge-blocking
check. The action runs your `.drift/suite.yaml` against the configured
provider on every pull request, compares scores to the committed
baseline, and posts a rich PR comment with a per-case diff.

**Runtime:** native Node 20 (no Docker). Bundled via `@vercel/ncc` and
shipped as `dist/index.js` inside this package. The action's metadata
(`action.yml`) lives at the **repository root** — GitHub Marketplace and
the `Drift-CI/drift-ci@v1` reference only resolve a root `action.yml` — with
its `runs.main` pointing back at `packages/action/dist/index.js`.

## Quick start

```yaml
# .github/workflows/drift.yml
name: drift-ci

on:
  pull_request:
    paths:
      - '.drift/**'
      - 'src/prompts/**'
      - 'src/lib/llm/**'

permissions:
  pull-requests: write     # needed for the PR comment
  contents: read

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # needed for baseline-source: main + base-ref diff

      - uses: actions/cache@v4
        with:
          path: ~/.cache/huggingface
          key: drift-ci-embeddings-all-MiniLM-L6-v2-v1

      - uses: drift-ci/drift-ci@v1
        with:
          provider: anthropic
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          threshold: '0.10'
          baseline-source: branch
          post-comment: 'true'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input              | Default              | Notes |
| ------------------ | -------------------- | ----- |
| `suite`            | `.drift/suite.yaml`  | Path to the suite YAML. |
| `config`           | `.drift/config.yaml` | Path to the drift-ci config. |
| `provider`         | _required_           | `anthropic` \| `openai` \| `google` \| `bedrock` \| `ollama`. |
| `api-key`          | —                    | Provider API key. Omit for `ollama` local or mock. |
| `model`            | — (from config)      | Override model name. |
| `threshold`        | — (from config)      | Regression threshold 0.0–1.0. |
| `baseline-source`  | `branch`             | `branch` (PR head) or `main` (origin/main). |
| `fail-on-regression` | `true`             | Exit non-zero if any case regressed. |
| `post-comment`     | `true`               | Post / update a PR comment via `GITHUB_TOKEN`. |
| `dashboard-url` / `dashboard-token` | — | Reserved for Phase 3. |

## Outputs

| Output             | Description |
| ------------------ | ----------- |
| `regression-count` | Number of regressions detected. |
| `avg-score`        | Average score across all cases. |
| `run-id`           | UUID for this run (for dashboard lookup later). |
| `baseline-changed` | `true` if this PR modifies any `.drift/baseline/` files. |
| `junit-path`       | Absolute path to `$RUNNER_TEMP/drift-junit.xml`. |

### Exposing JUnit to downstream steps

```yaml
      - uses: drift-ci/drift-ci@v1
        id: drift
        with:
          provider: anthropic
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: drift-junit
          path: ${{ steps.drift.outputs.junit-path }}
```

## `baseline-source: main` — comparing against origin/main

By default the action uses the baseline committed on the PR branch. This
is ideal for reviewing intentional behaviour changes: the developer runs
`drift-ci baseline accept` locally, commits the new baseline in the same
PR, and the action compares the PR's new scores against the PR's own
updated baseline (so the check stays green).

Setting `baseline-source: main` instead materialises
`.drift/baseline/` from `origin/main` and compares against that. This
is useful for gate workflows where you want to catch *any* score drop
vs. `main`, even when a PR is also committing baseline updates.

`fetch-depth: 0` on `actions/checkout` is required so `git fetch origin
main --depth=1` can resolve from a shallow clone.

## Fork pull requests

GitHub does **not** pass repository secrets to workflows triggered by
`pull_request` events from forks — by design. Without secrets the
provider call will fail, so drift-ci skips cleanly on fork PRs and
posts an explanatory comment instead of blocking the check.

If you want drift-ci to run against fork PRs that you've reviewed as
safe, apply a `safe-to-run-llm-tests` label on the PR and use the
split-workflow pattern below. **Do not skip the label check** — without
it a malicious fork can exfiltrate your API keys.

```yaml
# .github/workflows/drift-fork.yml
name: drift-ci (fork, gated)

on:
  pull_request_target:
    types: [labeled, synchronize]
    branches: [main]

permissions:
  pull-requests: write
  contents: read

jobs:
  gated-drift:
    # Only run when a maintainer has applied the label to *this* PR.
    if: >
      github.event_name == 'pull_request_target' &&
      contains(github.event.pull_request.labels.*.name, 'safe-to-run-llm-tests')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # Check out the fork's head SHA, not the base — we want to test
          # the contributor's code. The label gate is what makes this safe.
          ref: ${{ github.event.pull_request.head.sha }}
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          fetch-depth: 0

      - uses: drift-ci/drift-ci@v1
        with:
          provider: anthropic
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Scope the provider's API key with a low cost ceiling and a rate limit —
a bad commit in a forked PR shouldn't be able to drain your monthly
budget.

## Permissions

- `pull-requests: write` — required when `post-comment: true`.
- `contents: read` — required always.
- `GITHUB_TOKEN` must be exposed as an env var for the octokit client.
  Actions set it automatically under `secrets.GITHUB_TOKEN`; pass it
  through with `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.

## Exit codes

- `0` — clean run, or intentionally skipped (fork without key).
- `1` — one or more cases regressed beyond `threshold`. Controlled by
  `fail-on-regression`.
- `2` — transient provider failures exceeded the circuit-breaker
  threshold (`max(3, 20%)` of cases). This is the
  `RUN_ABORTED_TRANSIENT` state from the core engine — a signal that
  the upstream provider is degraded, not a behaviour regression.

## Invariants worth knowing

- **Baselines are git-committed JSON files.** There is no "promote"
  endpoint — accept locally, commit, review as code.
- **The action never imports `better-sqlite3`.** Storage is in-memory
  only; the SQLite adapter is CLI-only by design.
- **The `mock` provider is disabled.** Production builds refuse to
  instantiate it (`DRIFT_ENABLE_MOCK_PROVIDER` is never set inside the
  action).
- **Transient provider errors are not regressions.** See the exit-code
  table above.

## Development

From the repo root:

```bash
pnpm install
pnpm --filter @drift-ci/action build      # rebuild dist/index.js
pnpm --filter @drift-ci/action test       # unit tests
pnpm --filter @drift-ci/action test:coverage
```

The committed `dist/` artifact is what GitHub executes, so every PR
that touches `packages/action/src/**` must also refresh `dist/`. CI
enforces this via the `check-action-bundle` job.
