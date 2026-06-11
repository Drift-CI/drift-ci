# Releasing drift-ci

drift-ci uses [release-please](https://github.com/googleapis/release-please)
to cut releases from [Conventional Commits](https://www.conventionalcommits.org/)
on `main`. This doc covers the one-time maintainer setup and the normal
release flow.

## One-time setup

Before the first release can cut, the repository needs three things:

### 1. npm OIDC Trusted Publishing (tokenless)

`@drift-ci/core` and `@drift-ci/cli` publish **tokenlessly** via OIDC
Trusted Publishing — there is no `NPM_TOKEN` secret. The workflow's
`id-token: write` lets pnpm exchange a GitHub OIDC token for a short-lived
npm publish token scoped to this repo + workflow.

One-time, on npmjs.com, for **each** package (`@drift-ci/core` and
`@drift-ci/cli`) → *Settings* → *Trusted Publisher* → *GitHub Actions*:

- Organization or user: `Drift-CI`
- Repository: `drift-ci`
- Workflow filename: `release.yml`
- Environment: *(leave blank)*

**Enable 2FA** on the npm account — `--provenance` attestation requires it.

> Earlier releases used a classic Automation token in an `NPM_TOKEN` secret.
> After a tokenless release is confirmed working, that secret can be deleted.

### 2. Workflow permissions

*Settings* → *Actions* → *General* → *Workflow permissions*:

- Set **Read and write permissions** (release-please needs to create
  release PRs and tags).
- Tick **Allow GitHub Actions to create and approve pull requests**.

### 3. Marketplace listing (Action only)

**The action metadata must live at the repo root** (`action.yml`), not in
`packages/action/` — Marketplace, and the `Drift-CI/drift-ci@v1` reference,
only resolve a *root* `action.yml`. The root file's `runs.main` points at
`packages/action/dist/index.js`.

After a release whose tag contains the root `action.yml` lands (≥ `v1.0.1`):

1. Go to the repo's *Releases* page.
2. Edit that release.
3. Tick **Publish this Action to the GitHub Marketplace** — GitHub
   validates the root `action.yml` (`branding` is already set), shows a
   preview, and lists it.
4. Assign a primary category (**Testing** is the right fit).

That's a one-time action; subsequent `v1.x.y` releases auto-update the
Marketplace listing.

### 4. First release is forced to 1.0.0

The public repo starts from a single squashed commit — the pre-release
history is intentionally not published. To make release-please cut
`1.0.0` for every package on that fresh history, each package in
`release-please-config.json` carries a `"release-as": "1.0.0"` override.

**Remove those four `release-as` lines immediately after the first
release merges**, in the same push that removes nothing else — otherwise
every subsequent release PR keeps proposing 1.0.0. Once removed,
release-please resumes computing versions from Conventional Commits.

## Normal release flow

1. Merge PRs to `main` using [Conventional
   Commits](https://www.conventionalcommits.org/) (`feat(scope):`,
   `fix(scope):`, `chore(scope):` — scopes are `core`, `cli`,
   `action`). The pre-existing milestone commits already follow this.
2. release-please watches `main` and keeps one open PR per package —
   titled `chore(core): release 0.2.0`, `chore(cli): release 0.2.0`,
   etc. The PR carries the computed next version and a CHANGELOG
   update derived from commit messages since the last tag.
3. When you're ready to ship, merge the release PR. That push to
   `main` re-runs the release workflow, which this time sees that the
   manifest version now matches the commit, cuts a GitHub release,
   and triggers publishing:
   - `@drift-ci/core` → npm (provenance-attested)
   - `drift-ci` → npm (provenance-attested)
   - `packages/action` → git tag `vX.Y.Z` at root + floating `vX` tag
     updated to match. Users reference `drift-ci/drift-ci@v1`.
4. Verify the release:
   - `npm view @drift-ci/core version` matches.
   - `npm view drift-ci version` matches.
   - `git tag --list | grep ^v` shows the new action tag and updated
     floating major.
   - Marketplace listing updates (takes ~1 min).

## Versioning policy

The project launches at **1.0.0** for all packages (core, cli, action,
dashboard). From 1.0.0 on, strict semver applies: the floating `v1` tag
tracks the latest `v1.x.y` so Action users never see a breaking change
unless they opt into `v2`.

## Hotfixes

To ship a patch that bypasses the backlog:

1. Branch from the last release tag, not `main`.
2. Cherry-pick the fix; keep the commit message conventional
   (`fix(core): …`).
3. Force-push a tag `vX.Y.(Z+1)` and a release PR against `main` that
   cherry-picks the same commit to keep the two histories aligned.
4. Or: use release-please's
   [`release-as`](https://github.com/googleapis/release-please#manifest-releaser-options)
   override for out-of-band versioning.

Prefer a normal release when you can — hotfixes are error-prone.

## Rolling back

If a release ships a bug:

- **npm**: `npm deprecate <package>@<version> "use <newer>"`. Do NOT
  unpublish — it breaks dependents. Ship a patch release instead.
- **Marketplace**: update the `v1` floating tag to point at the
  previous good tag (`git tag -f v1 <good-sha> && git push -f origin v1`)
  until the patch ships.
