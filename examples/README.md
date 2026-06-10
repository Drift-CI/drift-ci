# drift-ci examples

Copy-paste-ready suites and CI workflow templates. The suites under
[`suites/`](suites/) exercise the three most common evaluation shapes;
the workflows under [`workflows/`](workflows/) show how to wire the
action into your CI.

## Suites

| File | Shape | Notes |
| --- | --- | --- |
| [`suites/chatbot.yaml`](suites/chatbot.yaml) | Multi-turn messages + `llm-judge` | Uses the `messages` case format for conversation context and delegates scoring to a judge model. |
| [`suites/rag.yaml`](suites/rag.yaml) | Single-turn + `cosine-similarity` | Embeddings-based semantic-similarity scoring for RAG answers that shouldn't match verbatim. |
| [`suites/classification.yaml`](suites/classification.yaml) | Structured output + `json-schema` | Validates that the model emits valid JSON matching a schema. |

Drop the YAML into `.drift/suite.yaml`, point `.drift/config.yaml` at your
provider, and run `drift-ci run`.

## Workflows

| File | Trigger | What it does |
| --- | --- | --- |
| [`workflows/basic.yml`](workflows/basic.yml) | `pull_request` | The smallest useful setup — caches the embeddings model, runs the action, posts a PR comment. |
| [`workflows/matrix.yml`](workflows/matrix.yml) | `pull_request` | Runs the same suite across multiple providers in parallel, uploading each as a separate JUnit artifact. |
| [`workflows/fork-gated.yml`](workflows/fork-gated.yml) | `pull_request_target` + `safe-to-run-llm-tests` label | The maintainer-gated pattern for running drift-ci against fork PRs without leaking secrets. |
| [`workflows/gitlab-ci.yml`](workflows/gitlab-ci.yml) | GitLab CI | Non-GitHub equivalent — runs the CLI via `npx`, uploads the JUnit report as a GitLab test artifact. |

See [packages/action/README.md](../packages/action/README.md) for the
full action inputs/outputs surface and fork-PR security write-up.
