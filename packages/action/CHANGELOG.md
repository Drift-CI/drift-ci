# Changelog

## [1.3.0](https://github.com/Drift-CI/drift-ci/compare/v1.2.1...v1.3.0) (2026-11-02)


### Features

* **action:** keyless dashboard sync via GitHub OIDC ([9499cb0](https://github.com/Drift-CI/drift-ci/commit/9499cb0518529027c17ec316624bf63b62289154))
* **action:** keyless dashboard sync via GitHub OIDC ([99c7b3b](https://github.com/Drift-CI/drift-ci/commit/99c7b3bff35298e91b352fc9afce30ad940a991a))

## [1.2.1](https://github.com/Drift-CI/drift-ci/compare/v1.2.0...v1.2.1) (2026-11-01)


### Bug Fixes

* **deps:** patch Dependabot security alerts and judge-fence ReDoS ([6246242](https://github.com/Drift-CI/drift-ci/commit/6246242e9aaa168a4289ff5d096e0b9cc0a201f7))
* **deps:** patch Dependabot security alerts and judge-fence ReDoS ([abb8f1e](https://github.com/Drift-CI/drift-ci/commit/abb8f1e5249e2723fa603335cb0714cea537e80f))

## [1.2.0](https://github.com/Drift-CI/drift-ci/compare/v1.1.5...v1.2.0) (2026-11-01)


### Features

* **action:** upload regression verdicts with each run ([1572113](https://github.com/Drift-CI/drift-ci/commit/157211330e345f85fbd23b555a912141bac1e45c))
* send regression verdicts on ingest (context.delta) ([d5c0e60](https://github.com/Drift-CI/drift-ci/commit/d5c0e60c375d513ecd175576b374321d81b635c7))

## [1.1.5](https://github.com/Drift-CI/drift-ci/compare/v1.1.4...v1.1.5) (2026-06-16)


### Bug Fixes

* **core:** stale-judge cases are not regressions ([#84](https://github.com/Drift-CI/drift-ci/issues/84)) ([aee323a](https://github.com/Drift-CI/drift-ci/commit/aee323a1f58b93e19839be7303ecc8b9a2dd928c))

## [1.1.4](https://github.com/Drift-CI/drift-ci/compare/v1.1.3...v1.1.4) (2026-06-15)


### Bug Fixes

* **action:** pass api-key to the judge provider ([#82](https://github.com/Drift-CI/drift-ci/issues/82)) ([9a5168d](https://github.com/Drift-CI/drift-ci/commit/9a5168dd5bae4dc829c27968cdd77be96182af45))

## [1.1.3](https://github.com/Drift-CI/drift-ci/compare/v1.1.2...v1.1.3) (2026-06-15)


### Bug Fixes

* **core:** resolve a judge for per-case and rubric-checklist evaluators ([d13a33e](https://github.com/Drift-CI/drift-ci/commit/d13a33e716694d1d41b8630c9d5413a4c682bb58))
* judge resolution, temperature on claude-4.7+, judge-JSON fences, Node 24 ([02bda41](https://github.com/Drift-CI/drift-ci/commit/02bda41530903966d169646f79e5ec1f889090c3))

## [1.1.2](https://github.com/Drift-CI/drift-ci/compare/v1.1.1...v1.1.2) (2026-06-12)


### Bug Fixes

* address high-severity CodeQL code-scanning alerts ([#63](https://github.com/Drift-CI/drift-ci/issues/63)) ([f0f5a64](https://github.com/Drift-CI/drift-ci/commit/f0f5a649a544cdb6d5da76ba11aec8ba8d4a5c2f))
* **deps:** resolve Dependabot security alerts ([#58](https://github.com/Drift-CI/drift-ci/issues/58)) ([30f3296](https://github.com/Drift-CI/drift-ci/commit/30f3296412a9ba2e2eb3f7592b9e9c7df43baf61))

## [1.1.1](https://github.com/Drift-CI/drift-ci/compare/v1.1.0...v1.1.1) (2026-06-12)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @drift-ci/core bumped to 1.1.1

## [1.1.0](https://github.com/Drift-CI/drift-ci/compare/v1.0.3...v1.1.0) (2026-06-11)


### Features

* initial public release of drift-ci ([bcb86ec](https://github.com/Drift-CI/drift-ci/commit/bcb86ec482a93948b772824d101649343186ae6d))


### Bug Fixes

* **action:** document the root action.yml location ([146e86b](https://github.com/Drift-CI/drift-ci/commit/146e86b2f652858242d55efa0fffc837f28fb8ba))
* **core:** bump openai SDK to v6.42.0 ([#27](https://github.com/Drift-CI/drift-ci/issues/27)) ([3898073](https://github.com/Drift-CI/drift-ci/commit/389807379f0ee572048830142fe96f9df967436e))
* **deps:** bump js-yaml, p-limit, better-sqlite3 (runtime-prod subset) ([03ceda9](https://github.com/Drift-CI/drift-ci/commit/03ceda904d27297ac8c89d48c65b1a710a1a1700))

## [1.0.3](https://github.com/Drift-CI/drift-ci/compare/v1.0.2...v1.0.3) (2026-06-11)


### Bug Fixes

* **deps:** bump js-yaml, p-limit, better-sqlite3 (runtime-prod subset) ([03ceda9](https://github.com/Drift-CI/drift-ci/commit/03ceda904d27297ac8c89d48c65b1a710a1a1700))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @drift-ci/core bumped to 1.0.2

## [1.0.2](https://github.com/Drift-CI/drift-ci/compare/v1.0.1...v1.0.2) (2026-06-11)


### Bug Fixes

* **core:** bump openai SDK to v6.42.0 ([#27](https://github.com/Drift-CI/drift-ci/issues/27)) ([3898073](https://github.com/Drift-CI/drift-ci/commit/389807379f0ee572048830142fe96f9df967436e))

## [1.0.1](https://github.com/Drift-CI/drift-ci/compare/v1.0.0...v1.0.1) (2026-06-11)


### Bug Fixes

* **action:** document the root action.yml location ([146e86b](https://github.com/Drift-CI/drift-ci/commit/146e86b2f652858242d55efa0fffc837f28fb8ba))

## [1.0.0](https://github.com/Drift-CI/drift-ci/compare/v0.1.0...v1.0.0) (2026-06-11)


### Features

* initial public release of drift-ci ([bcb86ec](https://github.com/Drift-CI/drift-ci/commit/bcb86ec482a93948b772824d101649343186ae6d))
