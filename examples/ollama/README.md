# Test your Ollama prompts in CI with drift-ci

Catch LLM regressions on every pull request using a model that runs on the GitHub Actions runner itself. No API key, no provider bill, nothing leaves the runner.

This folder is a complete, working example: a small support-ticket triage suite on `qwen2.5:1.5b`, baselines recorded from real runs, and a GitHub Actions workflow. On a standard `ubuntu-latest` runner the whole job takes about 80 seconds.

## What's here

| Path | What it is |
|---|---|
| [`.drift/suite.yaml`](.drift/suite.yaml) | Four test cases: two ticket labels (`exact-match`), a JSON triage reply (`json-schema`), and a policy answer that must mention "30 days" (`contains`). |
| [`.drift/config.yaml`](.drift/config.yaml) | Points drift-ci at Ollama on `localhost:11434` with `qwen2.5:1.5b`. |
| [`.drift/baseline/`](.drift/baseline) | The recorded scores each case is compared against. Commit these. |
| [`drift-ollama.yml`](drift-ollama.yml) | The GitHub Actions workflow. |

## Run it locally

You need [Ollama](https://ollama.com) running and Node.js 22 or later.

```bash
ollama pull qwen2.5:1.5b
cd examples/ollama
npx @drift-ci/cli run
```

All four cases should pass with a score of 1.000. Temperature is fixed at 0 for Ollama, so results are repeatable.

## Run it in GitHub Actions

1. Copy this example's `.drift/` folder to the root of your repository.
2. Copy [`drift-ollama.yml`](drift-ollama.yml) to `.github/workflows/drift-ollama.yml`.
3. Open a pull request.

The workflow starts Ollama's official Docker image as a [service container](https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/about-service-containers), pulls the model through Ollama's API, then runs the drift-ci Action with `provider: ollama`. No `api-key` input is needed:

```yaml
services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - 11434:11434
steps:
  - uses: actions/checkout@v4
  - name: Pull the model
    run: curl -sf http://localhost:11434/api/pull -d '{"model": "qwen2.5:1.5b", "stream": false}'
  - uses: Drift-CI/drift-ci@v1
    with:
      provider: ollama
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

drift-ci posts a results table on the pull request and fails the check when a case's score drops below its baseline.

## See it catch a regression

Change `model` in `.drift/config.yaml` from `qwen2.5:1.5b` to the smaller `qwen2.5:0.5b` (and `OLLAMA_MODEL` in the workflow to match), then run again. On our runs, three of the four cases regress:

```text
  ✓ classify-billing         pass                 score=1.000
  ✗ classify-shipping        pass                 score=0.000 Δ-1.000  [REGRESSION]
  ✗ triage-json              pass                 score=0.000 Δ-1.000  [REGRESSION]
  ✗ reply-mentions-refund-window pass                 score=0.000 Δ-1.000  [REGRESSION]
✗ 3 regression(s) detected.
```

The smaller model mislabels the shipping ticket, stops returning valid JSON, and drops the refund window from its answer. drift-ci exits with code 1, so the pull request can't merge until the change is fixed or the new behaviour is deliberately accepted:

```bash
npx @drift-ci/cli baseline accept .drift/suite.yaml --cases triage-json
```

## Make it yours

- **Swap in your prompts.** Each case has a `systemPrompt` and an `input`. Copy the prompts your app uses, and pick the evaluator that matches what "correct" means: `exact-match` for labels, `json-schema` for structured output, `contains` for facts that must appear, `llm-judge` for open-ended answers.
- **Record your own baselines.** Run `npx @drift-ci/cli run`, check the results, then `npx @drift-ci/cli baseline accept .drift/suite.yaml --all` and commit `.drift/baseline/`.
- **Use a bigger model.** Any model your runner can hold works, but standard GitHub runners are CPU-only, so larger models run noticeably slower. On a GPU runner, give the service container GPU access (`options: --gpus all`).
- **Use a remote Ollama server.** Set `baseUrl` under `provider` in `.drift/config.yaml`, and drop the service container.
- **Pin versions.** For fully repeatable runs, pin the image (`ollama/ollama:<version>`) as well as the model tag.

## Notes

- Editing a case's `systemPrompt`, `input` or evaluators changes the test itself, so drift-ci marks that baseline as stale rather than comparing scores. Re-record the baseline after intentional test edits.
- drift-ci reads baselines from `.drift/baseline/` at the repository root, which is why the `.drift/` folder goes there.

See the [main README](../../README.md) for every evaluator, provider and option.
