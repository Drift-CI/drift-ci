# Changelog

## [1.10.0](https://github.com/Drift-CI/drift-ci/compare/core-v1.9.1...core-v1.10.0) (2026-11-17)


### Features

* **core:** appendCasesToSuite shared by drift-ci import and drift-ci.com ([#206](https://github.com/Drift-CI/drift-ci/issues/206)) ([dd054cb](https://github.com/Drift-CI/drift-ci/commit/dd054cb2de793a825441a2a03053fb8cadf9b9fa))
* **core:** multi-step tool cases with scripted tool results ([#211](https://github.com/Drift-CI/drift-ci/issues/211)) ([b0d8429](https://github.com/Drift-CI/drift-ci/commit/b0d8429a4d39ae40e17b57771993555a7da3a948))


### Bug Fixes

* **core:** scan private-key blocks in one pass ([#205](https://github.com/Drift-CI/drift-ci/issues/205)) ([f86fc1c](https://github.com/Drift-CI/drift-ci/commit/f86fc1ccaf9b688bed349965f418d45560dcf548))

## [1.9.1](https://github.com/Drift-CI/drift-ci/compare/core-v1.9.0...core-v1.9.1) (2026-11-17)


### Bug Fixes

* **core:** make secret redaction linear-time on crafted input ([#202](https://github.com/Drift-CI/drift-ci/issues/202)) ([1c42e25](https://github.com/Drift-CI/drift-ci/commit/1c42e2512e0b0bff86906f5d2623b52552eb41c7))

## [1.9.0](https://github.com/Drift-CI/drift-ci/compare/core-v1.8.0...core-v1.9.0) (2026-11-17)


### Features

* **core:** light @drift-ci/core/import entry for trace conversion ([#198](https://github.com/Drift-CI/drift-ci/issues/198)) ([365f93e](https://github.com/Drift-CI/drift-ci/commit/365f93e2fff35f25fecbd44025dbc58cfdf5662a))

## [1.8.0](https://github.com/Drift-CI/drift-ci/compare/core-v1.7.0...core-v1.8.0) (2026-11-16)


### Features

* **core:** faithfulness evaluator and case context for RAG ([#194](https://github.com/Drift-CI/drift-ci/issues/194)) ([d07b1d9](https://github.com/Drift-CI/drift-ci/commit/d07b1d9a67e35d98b5847014173dba2069314020))
* **core:** tool definitions, provider tool calls and the tool-call evaluator ([#197](https://github.com/Drift-CI/drift-ci/issues/197)) ([1b1404e](https://github.com/Drift-CI/drift-ci/commit/1b1404eae4f2805e86708902818a00f52649c8f1))


### Bug Fixes

* **core:** redact current OpenAI keys and GitHub and Slack tokens ([#193](https://github.com/Drift-CI/drift-ci/issues/193)) ([38514c0](https://github.com/Drift-CI/drift-ci/commit/38514c08827bd24fdfe8518b3b307de87058eb52))

## [1.7.0](https://github.com/Drift-CI/drift-ci/compare/core-v1.6.1...core-v1.7.0) (2026-11-16)


### Features

* drift-ci import turns production chat traces into test cases ([#189](https://github.com/Drift-CI/drift-ci/issues/189)) ([6fe5d18](https://github.com/Drift-CI/drift-ci/commit/6fe5d189b6fb1fa3836c416312a1afb5e9e97cf3))

## [1.6.1](https://github.com/Drift-CI/drift-ci/compare/core-v1.6.0...core-v1.6.1) (2026-11-12)


### Bug Fixes

* **deps:** bump @anthropic-ai/bedrock-sdk to 0.36 (clears fast-xml-parser alert) ([#179](https://github.com/Drift-CI/drift-ci/issues/179)) ([060b447](https://github.com/Drift-CI/drift-ci/commit/060b447825bdf2c0822c0b8938b853fe8e17fe55))

## [1.6.0](https://github.com/Drift-CI/drift-ci/compare/core-v1.5.0...core-v1.6.0) (2026-11-09)


### Features

* repeated sampling — run cases N times, score the median ([#168](https://github.com/Drift-CI/drift-ci/issues/168)) ([44db714](https://github.com/Drift-CI/drift-ci/commit/44db7145fcf9660b45645b2b3a2cc11d21160081))

## [1.5.0](https://github.com/Drift-CI/drift-ci/compare/core-v1.4.0...core-v1.5.0) (2026-11-09)


### Features

* git/PR context and aborted flag on dashboard sync ([#163](https://github.com/Drift-CI/drift-ci/issues/163)) ([3e1c543](https://github.com/Drift-CI/drift-ci/commit/3e1c543074a4fd36ea1874792c2e95c803acc82c))

## [1.4.0](https://github.com/Drift-CI/drift-ci/compare/core-v1.3.0...core-v1.4.0) (2026-11-09)


### Features

* **core:** add contains evaluator ([#154](https://github.com/Drift-CI/drift-ci/issues/154)) ([79ac01b](https://github.com/Drift-CI/drift-ci/commit/79ac01b3f046dd91d875fe3196b464e55699eb09))

## [1.3.0](https://github.com/Drift-CI/drift-ci/compare/core-v1.2.1...core-v1.3.0) (2026-11-03)


### Features

* **core:** carry the partial run on RunAbortedTransientError ([bb2ede9](https://github.com/Drift-CI/drift-ci/commit/bb2ede9eb8daf925c6730cad44042a4a11a900f0))
* sync runs aborted for transient errors ([dd8bb05](https://github.com/Drift-CI/drift-ci/commit/dd8bb05c01c7ecec01bc4cdb02e93190b41742cb))

## [1.2.1](https://github.com/Drift-CI/drift-ci/compare/core-v1.2.0...core-v1.2.1) (2026-11-01)


### Bug Fixes

* **deps:** patch Dependabot security alerts and judge-fence ReDoS ([6246242](https://github.com/Drift-CI/drift-ci/commit/6246242e9aaa168a4289ff5d096e0b9cc0a201f7))
* **deps:** patch Dependabot security alerts and judge-fence ReDoS ([abb8f1e](https://github.com/Drift-CI/drift-ci/commit/abb8f1e5249e2723fa603335cb0714cea537e80f))

## [1.2.0](https://github.com/Drift-CI/drift-ci/compare/core-v1.1.4...core-v1.2.0) (2026-11-01)


### Features

* **core:** send regression verdicts on ingest (context.delta) ([183a55c](https://github.com/Drift-CI/drift-ci/commit/183a55c48a6d5f81ee812d9bd00087b7c2361e1f))
* send regression verdicts on ingest (context.delta) ([d5c0e60](https://github.com/Drift-CI/drift-ci/commit/d5c0e60c375d513ecd175576b374321d81b635c7))

## [1.1.4](https://github.com/Drift-CI/drift-ci/compare/core-v1.1.3...core-v1.1.4) (2026-06-16)


### Bug Fixes

* **core:** stale-judge cases are not regressions ([#84](https://github.com/Drift-CI/drift-ci/issues/84)) ([aee323a](https://github.com/Drift-CI/drift-ci/commit/aee323a1f58b93e19839be7303ecc8b9a2dd928c))

## [1.1.3](https://github.com/Drift-CI/drift-ci/compare/core-v1.1.2...core-v1.1.3) (2026-06-15)


### Bug Fixes

* **core:** omit temperature for claude-4.7+ models that reject it ([2584fde](https://github.com/Drift-CI/drift-ci/commit/2584fde4b6c6ee54c65f6b22ba6c603a7fa60a4b))
* **core:** resolve a judge for per-case and rubric-checklist evaluators ([d13a33e](https://github.com/Drift-CI/drift-ci/commit/d13a33e716694d1d41b8630c9d5413a4c682bb58))
* **core:** strip a surrounding code fence from judge responses ([e432042](https://github.com/Drift-CI/drift-ci/commit/e4320422250a62785ca106647c89b130007edabe))
* judge resolution, temperature on claude-4.7+, judge-JSON fences, Node 24 ([02bda41](https://github.com/Drift-CI/drift-ci/commit/02bda41530903966d169646f79e5ec1f889090c3))

## [1.1.2](https://github.com/Drift-CI/drift-ci/compare/core-v1.1.1...core-v1.1.2) (2026-06-12)


### Bug Fixes

* address high-severity CodeQL code-scanning alerts ([#63](https://github.com/Drift-CI/drift-ci/issues/63)) ([f0f5a64](https://github.com/Drift-CI/drift-ci/commit/f0f5a649a544cdb6d5da76ba11aec8ba8d4a5c2f))
* **deps:** resolve Dependabot security alerts ([#58](https://github.com/Drift-CI/drift-ci/issues/58)) ([30f3296](https://github.com/Drift-CI/drift-ci/commit/30f3296412a9ba2e2eb3f7592b9e9c7df43baf61))

## [1.1.1](https://github.com/Drift-CI/drift-ci/compare/core-v1.1.0...core-v1.1.1) (2026-06-12)


### Bug Fixes

* **core:** require Node &gt;=22.13 to match the toolchain floor ([#52](https://github.com/Drift-CI/drift-ci/issues/52)) ([8bd658c](https://github.com/Drift-CI/drift-ci/commit/8bd658c7b0dd8687e8bdb406a41df45c2a1eb7ca))

## [1.1.0](https://github.com/Drift-CI/drift-ci/compare/core-v1.0.2...core-v1.1.0) (2026-06-11)


### Features

* initial public release of drift-ci ([bcb86ec](https://github.com/Drift-CI/drift-ci/commit/bcb86ec482a93948b772824d101649343186ae6d))


### Bug Fixes

* **core:** bump openai SDK to v6.42.0 ([#27](https://github.com/Drift-CI/drift-ci/issues/27)) ([3898073](https://github.com/Drift-CI/drift-ci/commit/389807379f0ee572048830142fe96f9df967436e))
* **deps:** bump js-yaml, p-limit, better-sqlite3 (runtime-prod subset) ([03ceda9](https://github.com/Drift-CI/drift-ci/commit/03ceda904d27297ac8c89d48c65b1a710a1a1700))

## [1.0.2](https://github.com/Drift-CI/drift-ci/compare/core-v1.0.1...core-v1.0.2) (2026-06-11)


### Bug Fixes

* **deps:** bump js-yaml, p-limit, better-sqlite3 (runtime-prod subset) ([03ceda9](https://github.com/Drift-CI/drift-ci/commit/03ceda904d27297ac8c89d48c65b1a710a1a1700))

## [1.0.1](https://github.com/Drift-CI/drift-ci/compare/core-v1.0.0...core-v1.0.1) (2026-06-11)


### Bug Fixes

* **core:** bump openai SDK to v6.42.0 ([#27](https://github.com/Drift-CI/drift-ci/issues/27)) ([3898073](https://github.com/Drift-CI/drift-ci/commit/389807379f0ee572048830142fe96f9df967436e))

## [1.0.0](https://github.com/Drift-CI/drift-ci/compare/core-v0.1.0...core-v1.0.0) (2026-06-10)


### Features

* initial public release of drift-ci ([bcb86ec](https://github.com/Drift-CI/drift-ci/commit/bcb86ec482a93948b772824d101649343186ae6d))
