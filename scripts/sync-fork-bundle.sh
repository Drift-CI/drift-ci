#!/usr/bin/env bash
# Maintainers: apply the runner-built GitHub Action bundle to a fork PR.
#
# The ncc bundle differs across machines, so contributors can't produce a dist
# that matches CI. On fork PRs the "action bundle" workflow uploads the bundle it
# built as the `action-dist` artifact; this script commits it to the PR branch
# (needs "Allow edits by maintainers" on the PR and an authenticated `gh`).
#
# Usage: scripts/sync-fork-bundle.sh <pr-number>
set -euo pipefail

pr="${1:?usage: scripts/sync-fork-bundle.sh <pr-number>}"
repo="${DRIFT_REPO:-Drift-CI/drift-ci}"

info=$(gh pr view "$pr" -R "$repo" --json headRepositoryOwner,headRepository,headRefName,headRefOid,maintainerCanModify,isCrossRepository \
  --jq '"\(.headRepositoryOwner.login)/\(.headRepository.name) \(.headRefName) \(.headRefOid) \(.maintainerCanModify) \(.isCrossRepository)"')
read -r head_repo head_ref head_sha can_modify cross <<<"$info"

if [ "$cross" != "true" ]; then
  echo "PR #$pr isn't from a fork; the bundle workflow syncs same-repo PRs itself." >&2; exit 1
fi
if [ "$can_modify" != "true" ]; then
  echo "PR #$pr doesn't allow maintainer edits. Ask the author to tick \"Allow edits by maintainers\"." >&2; exit 1
fi

run_id=$(gh run list -R "$repo" --workflow bundle.yml --commit "$head_sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
if [ -z "$run_id" ]; then
  echo "No bundle workflow run for $head_sha yet. Approve the PR's workflow runs first." >&2; exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if ! gh run download "$run_id" -R "$repo" -n action-dist -D "$tmp/dist" 2>/dev/null; then
  echo "Run $run_id has no action-dist artifact: the bundle is already in sync, or the run hasn't finished." >&2; exit 1
fi

git -c core.autocrlf=false clone -q --depth 1 --branch "$head_ref" "https://github.com/$head_repo.git" "$tmp/repo"
rm -rf "$tmp/repo/packages/action/dist"
mkdir -p "$tmp/repo/packages/action/dist"
cp -R "$tmp/dist/." "$tmp/repo/packages/action/dist/"

cd "$tmp/repo"
git -c core.autocrlf=false add -A packages/action/dist
if git diff --cached --quiet; then
  echo "Bundle already in sync on $head_repo:$head_ref."; exit 0
fi
# No [skip ci]: the checks must re-run on the new head so the PR can merge normally,
# and a squash merge would otherwise inherit the marker and skip the Release workflow.
git -c core.autocrlf=false commit -q -m "build(action): sync dist bundle"
git push -q origin "HEAD:$head_ref"
echo "Pushed the runner-built bundle to $head_repo:$head_ref (PR #$pr)."
