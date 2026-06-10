<!--
Thanks for contributing to drift-ci!

Before you open this PR, please confirm:
- [ ] You have read CONTRIBUTING.md
- [ ] Commits are signed off (DCO): `git commit -s ...`
- [ ] Commit messages follow Conventional Commits
- [ ] You have added or updated tests
- [ ] You have updated relevant docs (architecture / roadmap) if behaviour changed

If this is a draft PR, mark it as such in the UI. Keep one logical change per PR.
-->

## Summary

<!-- One paragraph. What does this PR do, and why? -->

## Related issues

<!-- Closes #123, refs #456 -->

## Changes

<!-- Bullet list of notable changes. -->

- 

## Test plan

<!--
How did you verify this works? If it is a bug fix, describe the failing case
that now passes. If it is a new feature, describe the happy path and at
least one edge case you exercised.
-->

- [ ] `pnpm test` passes locally
- [ ] `pnpm build` passes locally
- [ ] `pnpm --filter @drift-ci/dashboard typecheck` passes (for dashboard changes)
- [ ] 

## Architecture notes

<!--
If this PR changes behaviour described in docs/drift-ci-architecture.md,
call out the section you touched and why. Do not renumber existing
architecture sections — code cross-references point at them.
-->

## Checklist

- [ ] Commits signed off (`-s` / DCO)
- [ ] Conventional Commits format
- [ ] Tests added or updated
- [ ] Docs updated if behaviour changed
- [ ] No secrets, credentials, or private data in this diff
