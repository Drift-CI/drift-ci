# @drift-ci/cli

The command-line interface for [drift-ci](https://github.com/Drift-CI/drift-ci) —
behaviour regression testing for LLM applications. Installs the `drift-ci`
command.

## Install

```sh
npm install -g @drift-ci/cli
# or run without installing:
npx @drift-ci/cli --help
```

## Usage

```sh
drift-ci init             # scaffold a drift suite
drift-ci run              # run the suite against your provider
drift-ci baseline accept .drift/suite.yaml --all  # accept intentional changes
```

## Importing production traces

Turn real conversations into test cases:

```sh
drift-ci import traces.jsonl            # adds cases to the suite in .drift/config.yaml
drift-ci import traces.jsonl --dry-run  # print the YAML instead
```

Each line of the file is one chat trace, in OpenAI shape (`{"messages": [...]}` with `system`, `user` and `assistant` roles) or Anthropic shape (`{"system": "...", "messages": [...]}`). The last assistant reply becomes the case's `expected` answer, the system messages become `systemPrompt`, and the rest becomes `input` (one user turn) or `messages`. An optional `id` field names the case; otherwise the ID is a hash of the conversation, so importing the same file twice adds nothing new.

Thinking blocks are dropped. Traces with tool calls, images or other non-text content are skipped and listed with their line numbers.

| Option | Default | |
|---|---|---|
| `--suite <path>` | the config's `suite` | Suite file to add cases to. Created (with `llm-judge`) if missing. |
| `--config <path>` | `.drift/config.yaml` | Config to read the suite path from. |
| `--prefix <p>` | `prod` | Prefix for case IDs (lowercase letters, digits, `-` and `_`). |
| `--limit <n>` | none | Import at most N new cases. |
| `--evaluator <name>` | the suite's evaluators | Evaluator for the imported cases; repeatable. Names are validated. |
| `--dry-run` | off | Print the YAML that would be added and write nothing. |

Imported cases are scored against the production reply, so use an evaluator that compares with `expected` usefully: `llm-judge` or `cosine-similarity`. The command warns if the suite has neither and you didn't pass `--evaluator`.

**Review traces before committing them.** API keys, tokens and private keys are redacted automatically, but personal data such as names, emails and addresses is not.

Comments in an existing suite are kept. The YAML library may normalise some formatting, such as folded `>` scalars or the spacing before inline comments, so check the diff.

Exit codes: `0` cases were imported (or all were already present), `1` nothing could be imported or the result failed validation (nothing is written), `2` unreadable input, suite or config, or invalid options.

After importing, run `drift-ci run`, then `drift-ci baseline accept <suite> --all` to record today's scores, and commit the suite and `.drift/baseline/`.

See the [drift-ci repository](https://github.com/Drift-CI/drift-ci) for full
documentation.

## License

MIT © drift-ci contributors
