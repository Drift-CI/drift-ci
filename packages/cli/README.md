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

Each line of the file is one chat trace, in OpenAI shape (`{"messages": [...]}` with `system`, `developer`, `user` and `assistant` roles) or Anthropic shape (`{"system": "...", "messages": [...]}`). The last assistant reply becomes the case's `expected` answer, the system and developer messages become `systemPrompt`, and the rest becomes `input` (one user turn) or `messages`. An optional `id` field names the case; otherwise the ID is a hash of the conversation, so importing the same file twice adds nothing new.

Thinking blocks are dropped. Traces that can't become a case (images or other non-text content, tool calls the importer can't replay (see below), invalid JSON, no final assistant reply, turns that don't alternate) are skipped and listed with their line numbers (the first 20, then a count).

Traces with tool calls become multi-step `tool-call` cases. The recorded calls become `expectedCalls`, the recorded results become `toolResults`, the final reply becomes `expected`, and the evaluators are `tool-call` and `llm-judge`. Send a top-level `tools` array (OpenAI or Anthropic shape) with the trace, or define the tools in the suite. A case that calls a tool defined in neither place is skipped, and the import lists the missing names. If nothing else was added, the command exits 1. Arguments that are free text (over 40 characters or containing a line break) are left out of the expectations. Only tool calls after the last user message are supported; traces with earlier tool calls are skipped.

| Option | Default | |
|---|---|---|
| `--suite <path>` | the config's `suite`, or `.drift/suite.yaml` if there is no config | Suite file to add cases to. Created (with `llm-judge`) if missing. |
| `--config <path>` | `.drift/config.yaml` | Config to read the suite path from. |
| `--prefix <p>` | `prod` | Prefix for case IDs (lowercase letters, digits, `-` and `_`). |
| `--limit <n>` | none | Import at most N new cases. |
| `--evaluator <name>` | the suite's evaluators | Evaluator for the imported cases; repeatable. Names are validated. |
| `--dry-run` | off | Print the YAML that would be added and write nothing. |

Imported cases are scored against the production reply, so use an evaluator that compares with `expected` usefully: `llm-judge` or `cosine-similarity`. The command warns if the suite has neither and you didn't pass `--evaluator`.

**Review traces before committing them.** Common secret formats (AWS access keys, Anthropic and OpenAI API keys, GitHub and Slack tokens, JWTs and PEM private keys) are redacted automatically. Other credentials, such as bearer tokens or passwords in plain text, are not, and neither is personal data such as names, emails and addresses.

Comments in an existing suite are kept. The YAML library may normalise some formatting, such as folded `>` scalars or the spacing before inline comments, so check the diff.

Exit codes: `0` cases were imported, or every usable trace was already present (re-importing a file is safe), `1` nothing could be imported or the result failed validation (nothing is written), `2` the input, suite or config can't be read, the suite can't be written, or `--prefix`/`--evaluator` is invalid. Other option errors (such as a bad `--limit`) exit `1`, as for every command.

After importing, run `drift-ci run`, then `drift-ci baseline accept <suite> --all` to record today's scores, and commit the suite and `.drift/baseline/`.

See the [drift-ci repository](https://github.com/Drift-CI/drift-ci) for full
documentation.

## License

MIT © drift-ci contributors
