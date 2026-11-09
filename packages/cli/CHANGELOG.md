# Changelog

## [1.3.3](https://github.com/Drift-CI/drift-ci/compare/cli-v1.3.2...cli-v1.3.3) (2026-11-09)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @drift-ci/core bumped to 1.4.0

## [1.3.2](https://github.com/Drift-CI/drift-ci/compare/cli-v1.3.1...cli-v1.3.2) (2026-11-08)


### Bug Fixes

* **cli:** drift init --dir writes a working config and next steps ([#146](https://github.com/Drift-CI/drift-ci/issues/146)) ([18ce571](https://github.com/Drift-CI/drift-ci/commit/18ce571e7c27def15f97c763aac40dd9a48b0752))

## [1.3.1](https://github.com/Drift-CI/drift-ci/compare/cli-v1.3.0...cli-v1.3.1) (2026-11-07)


### Bug Fixes

* **action:** correct baseline accept command in PR comment ([13fe99b](https://github.com/Drift-CI/drift-ci/commit/13fe99b1cae865526457533234112d9a2907dd59))
* **cli:** correct baseline accept hint in text reporter ([6f69f31](https://github.com/Drift-CI/drift-ci/commit/6f69f316d7452d34ccefc007a68e0d9c2787c1f6))
* **cli:** correct baseline init hints ([65ab1f0](https://github.com/Drift-CI/drift-ci/commit/65ab1f043faa9ec4a517954d97a4c2cfaceac42d))

## [1.3.0](https://github.com/Drift-CI/drift-ci/compare/cli-v1.2.1...cli-v1.3.0) (2026-11-03)


### Features

* **cli:** sync runs aborted for transient errors to the dashboard ([2f28089](https://github.com/Drift-CI/drift-ci/commit/2f280891124e67fde4ddfb227f84a785c4f454fb))
* sync runs aborted for transient errors ([dd8bb05](https://github.com/Drift-CI/drift-ci/commit/dd8bb05c01c7ecec01bc4cdb02e93190b41742cb))


### Bug Fixes

* **action,cli:** harden aborted-run sync ([6f0d2c6](https://github.com/Drift-CI/drift-ci/commit/6f0d2c6d4f3091069f58e81bf6c81ddc48bc0522))
* **cli:** send dashboard runs once, with the delta ([d753b13](https://github.com/Drift-CI/drift-ci/commit/d753b135bcfdf4401a9333d053b9bf30e6f63b07))

## [1.2.1](https://github.com/Drift-CI/drift-ci/compare/cli-v1.2.0...cli-v1.2.1) (2026-11-01)


### Bug Fixes

* **deps:** patch Dependabot security alerts and judge-fence ReDoS ([6246242](https://github.com/Drift-CI/drift-ci/commit/6246242e9aaa168a4289ff5d096e0b9cc0a201f7))
* **deps:** patch Dependabot security alerts and judge-fence ReDoS ([abb8f1e](https://github.com/Drift-CI/drift-ci/commit/abb8f1e5249e2723fa603335cb0714cea537e80f))

## [1.2.0](https://github.com/Drift-CI/drift-ci/compare/cli-v1.1.4...cli-v1.2.0) (2026-11-01)


### Features

* **cli:** upload regression verdicts with each run ([88ab16e](https://github.com/Drift-CI/drift-ci/commit/88ab16e25bad581743edec8954b7dde4ec7f42c4))
* send regression verdicts on ingest (context.delta) ([d5c0e60](https://github.com/Drift-CI/drift-ci/commit/d5c0e60c375d513ecd175576b374321d81b635c7))

## [1.1.4](https://github.com/Drift-CI/drift-ci/compare/cli-v1.1.3...cli-v1.1.4) (2026-06-16)


### Bug Fixes

* **cli:** report the real package version in --version ([c5e8d08](https://github.com/Drift-CI/drift-ci/commit/c5e8d08a11897de7577734fd1bc9a9da8b3a92b0))
* **cli:** report the real package version in --version ([3b23356](https://github.com/Drift-CI/drift-ci/commit/3b233561a8d815dfe77ad66efdf662c393175dcb))

## [1.1.3](https://github.com/Drift-CI/drift-ci/compare/cli-v1.1.2...cli-v1.1.3) (2026-06-15)


### Bug Fixes

* **core:** resolve a judge for per-case and rubric-checklist evaluators ([d13a33e](https://github.com/Drift-CI/drift-ci/commit/d13a33e716694d1d41b8630c9d5413a4c682bb58))
* judge resolution, temperature on claude-4.7+, judge-JSON fences, Node 24 ([02bda41](https://github.com/Drift-CI/drift-ci/commit/02bda41530903966d169646f79e5ec1f889090c3))

## [1.1.2](https://github.com/Drift-CI/drift-ci/compare/cli-v1.1.1...cli-v1.1.2) (2026-06-12)


### Bug Fixes

* address high-severity CodeQL code-scanning alerts ([#63](https://github.com/Drift-CI/drift-ci/issues/63)) ([f0f5a64](https://github.com/Drift-CI/drift-ci/commit/f0f5a649a544cdb6d5da76ba11aec8ba8d4a5c2f))

## [1.1.1](https://github.com/Drift-CI/drift-ci/compare/cli-v1.1.0...cli-v1.1.1) (2026-06-12)


### Bug Fixes

* **cli:** honor --no-baseline (was read from the wrong option attribute) ([#50](https://github.com/Drift-CI/drift-ci/issues/50)) ([45f098f](https://github.com/Drift-CI/drift-ci/commit/45f098f0bf6e3cc1de43aeab22effca48e60e7ad))

## [1.1.0](https://github.com/Drift-CI/drift-ci/compare/cli-v1.0.2...cli-v1.1.0) (2026-06-11)


### Features

* initial public release of drift-ci ([bcb86ec](https://github.com/Drift-CI/drift-ci/commit/bcb86ec482a93948b772824d101649343186ae6d))


### Bug Fixes

* **cli:** publish CLI as scoped @drift-ci/cli and build it in the publish job ([beaddc8](https://github.com/Drift-CI/drift-ci/commit/beaddc84be10c6c885efc100a3af6a63a0fd2ecc))
* **deps:** bump js-yaml, p-limit, better-sqlite3 (runtime-prod subset) ([03ceda9](https://github.com/Drift-CI/drift-ci/commit/03ceda904d27297ac8c89d48c65b1a710a1a1700))

## [1.0.2](https://github.com/Drift-CI/drift-ci/compare/cli-v1.0.1...cli-v1.0.2) (2026-06-11)


### Bug Fixes

* **deps:** bump js-yaml, p-limit, better-sqlite3 (runtime-prod subset) ([03ceda9](https://github.com/Drift-CI/drift-ci/commit/03ceda904d27297ac8c89d48c65b1a710a1a1700))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @drift-ci/core bumped to 1.0.2

## [1.0.1](https://github.com/Drift-CI/drift-ci/compare/cli-v1.0.0...cli-v1.0.1) (2026-06-11)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @drift-ci/core bumped to 1.0.1

## [1.0.0](https://github.com/Drift-CI/drift-ci/compare/cli-v0.1.0...cli-v1.0.0) (2026-06-11)


### Features

* initial public release of drift-ci ([bcb86ec](https://github.com/Drift-CI/drift-ci/commit/bcb86ec482a93948b772824d101649343186ae6d))


### Bug Fixes

* **cli:** publish CLI as scoped @drift-ci/cli and build it in the publish job ([beaddc8](https://github.com/Drift-CI/drift-ci/commit/beaddc84be10c6c885efc100a3af6a63a0fd2ecc))

## [1.0.0](https://github.com/Drift-CI/drift-ci/compare/drift-ci-v0.1.0...drift-ci-v1.0.0) (2026-06-11)


### Features

* initial public release of drift-ci ([bcb86ec](https://github.com/Drift-CI/drift-ci/commit/bcb86ec482a93948b772824d101649343186ae6d))
