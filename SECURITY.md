# Security Policy

## Supported versions

drift-ci is pre-1.0. Security fixes are applied to `main` and shipped in the
next release; previous minor versions are not patched.

| Version       | Supported          |
| ------------- | ------------------ |
| `main`        | :white_check_mark: |
| Latest tagged | :white_check_mark: |
| Older         | :x:                |

## Reporting a vulnerability

**Please do not open public GitHub issues for security reports.**

Report vulnerabilities privately to **security@drift-ci.dev**. Include:

- A description of the vulnerability and its impact.
- Steps to reproduce (proof-of-concept preferred).
- Affected versions, if known.
- Your contact information and whether you wish to be credited.

Alternatively, use GitHub's private vulnerability reporting on this repository.

## Disclosure process

- **Acknowledgement** within 3 business days of your report.
- **Triage and initial assessment** within 10 business days.
- **Coordinated disclosure** after a fix is available, or 90 days after your
  initial report — whichever comes first.
- We will credit the reporter in the release notes unless you ask us not to.

## Scope

In scope:

- The `drift-ci` CLI and `@drift-ci/core` package.
- The GitHub Action bundle in `packages/action/`.
- The dashboard code in `packages/dashboard/` once it lands.
- Supply-chain issues: published npm packages, the bundled action artifact,
  and Docker images we distribute.

Out of scope:

- Vulnerabilities in upstream LLM providers, embedding models, or third-party
  dependencies — report those to the respective vendors. We will upgrade
  affected dependencies once patches are available.
- Issues that require a compromised developer machine or repository write
  access (those are pre-conditions, not vulnerabilities in drift-ci).
- Denial of service against self-hosted deployments from authenticated users.

## Hall of fame

Researchers who report valid vulnerabilities will be listed here, with their
consent, after each release.
