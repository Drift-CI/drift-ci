# Contributing to drift-ci

Thanks for considering a contribution. This document covers the development
workflow, commit conventions, and the sign-off we require on every commit.

## Code of Conduct

By participating in this project you agree to abide by the
[Code of Conduct](CODE_OF_CONDUCT.md). Report unacceptable behaviour to
**conduct@drift-ci.dev**.

## Development setup

drift-ci is a pnpm + Turborepo monorepo. You will need:

- **Node.js 20 or newer** (see `engines` in the root `package.json`)
- **pnpm 10 or newer**

Install and build:

```bash
pnpm install
pnpm build
```

Common commands (all Turborepo-driven):

```bash
pnpm test          # run the full test suite
pnpm lint          # eslint
pnpm -r build      # force a fresh build in every package
pnpm --filter @drift-ci/core test      # scope to one package
```

Single-test runs (inside a package):

```bash
pnpm vitest run src/path/to/file.test.ts
```

## Where things live

- `packages/core/` — the provider-agnostic engine (`@drift-ci/core`).
- `packages/cli/` — the `drift-ci` binary.
- `packages/action/` — the GitHub Action.
- `packages/dashboard/` — the Next.js dashboard.
- `docs/drift-ci-architecture.md` — the canonical design document. Do not
  renumber sections; cross-references exist throughout the code.

## Submitting changes

1. **Open an issue first** for anything beyond a small fix — it is cheap to
   align on approach before writing code.
2. **Fork and branch** from `main`. Use a descriptive branch name.
3. **Keep changes scoped.** One logical change per pull request; split
   unrelated refactors into separate PRs.
4. **Add tests.** Every behaviour change must ship with a test that fails
   without the change.
5. **Update the docs.** If you change behaviour described in the architecture
   or plan, update those files in the same PR.
6. **Run the full test suite** locally before opening the PR.

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<body>

<footers>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`,
`build`, `ci`.

Examples:

```
feat(cli): add drift-ci config migrate command
fix(core): treat NaN current scores as NO_SCORE, never REGRESSION
docs(arch): clarify baseline-is-a-file invariant in §6
```

Breaking changes get a `!` after the type/scope and a `BREAKING CHANGE:`
footer.

## Developer Certificate of Origin (DCO)

drift-ci uses the DCO rather than a Contributor License Agreement. Every
commit must be signed off:

```bash
git commit -s -m "feat(core): add new thing"
```

This appends `Signed-off-by: Your Name <you@example.com>` to the commit
message, certifying that you have the right to submit the work under the
project's MIT license. The full text of the DCO is at
<https://developercertificate.org/>.

PRs with unsigned commits will fail CI. You can retro-sign with:

```bash
git rebase --signoff main
git push --force-with-lease
```

## What we look for in review

- **Tests.** Every PR that touches `src/` should also touch a test file.
- **No scope creep.** Resist bundling unrelated cleanups.
- **Respect the invariants.** See `CLAUDE.md` for the load-bearing design
  decisions (baselines-are-files, transient-is-not-a-regression,
  action-is-Node20, redaction-before-disk, etc.). Challenge edits that weaken
  them.
- **Doc hygiene.** Architecture section numbers are referenced by the code —
  never renumber. Add new sections at the end or edit in place.

## Getting help

- Open a GitHub Discussion for usage questions.
- Open a GitHub Issue for bugs or feature requests.
- For security issues, follow [SECURITY.md](SECURITY.md) — never open a
  public issue.

Thanks again for contributing.
