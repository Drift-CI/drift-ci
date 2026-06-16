# Changelog

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
