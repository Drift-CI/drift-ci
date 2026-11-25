#!/usr/bin/env node
// DCO check for pull requests (see CONTRIBUTING.md, "Developer Certificate of Origin").
//
// Every commit in the PR needs a `Signed-off-by: Name <email>` trailer whose email matches the
// commit's author email. Merge commits and commits authored by GitHub bot accounts
// (github-actions[bot] dist syncs and releases, dependabot[bot]) are skipped.
//
// In CI (.github/workflows/dco.yml) it reads the PR from GITHUB_EVENT_PATH and its commits from
// the GitHub API with GITHUB_TOKEN, then exits 1 if any commit fails. Locally:
//   GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=Drift-CI/drift-ci node scripts/dco/check.mjs <pr-number>
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SIGNOFF = /^Signed-off-by:\s*(.+?)\s*<([^<>\s]+)>\s*$/gim;

/** Check PR commits as GET /repos/{owner}/{repo}/pulls/{n}/commits returns them. */
export function checkCommits(commits) {
  const failures = [];
  let checked = 0;
  let skipped = 0;
  for (const c of commits) {
    if ((c.parents?.length ?? 0) > 1 || c.author?.type === 'Bot') {
      skipped++;
      continue;
    }
    checked++;
    const email = (c.commit?.author?.email ?? '').toLowerCase();
    const message = c.commit?.message ?? '';
    const signoffs = [...message.matchAll(SIGNOFF)].map((m) => m[2].toLowerCase());
    const subject = message.split('\n')[0];
    if (signoffs.length === 0) {
      failures.push({ sha: c.sha, subject, reason: 'no Signed-off-by trailer' });
    } else if (!signoffs.includes(email)) {
      failures.push({ sha: c.sha, subject, reason: `Signed-off-by doesn't match the author email <${email}>` });
    }
  }
  return { checked, skipped, failures };
}

async function fetchCommits(repo, pr, token) {
  const all = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${pr}/commits?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status} listing commits of #${pr}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

async function main() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_EVENT_PATH: eventPath, GITHUB_STEP_SUMMARY: summary } = process.env;
  const pr = process.argv[2] ?? (eventPath ? JSON.parse(readFileSync(eventPath, 'utf8')).pull_request?.number : undefined);
  if (!token || !repo || !pr) {
    console.error('dco: needs GITHUB_TOKEN, GITHUB_REPOSITORY and a pull request (event or argument).');
    process.exit(2);
  }
  const { checked, skipped, failures } = checkCommits(await fetchCommits(repo, pr, token));
  const lines = [`DCO: ${checked} commit(s) checked, ${skipped} skipped (merge or bot commits).`];
  if (failures.length === 0) {
    lines.push('All commits are signed off.');
  } else {
    lines.push('', `${failures.length} commit(s) need a sign-off:`);
    for (const f of failures) lines.push(`- ${f.sha.slice(0, 7)} ${f.subject}: ${f.reason}`);
    lines.push(
      '',
      'Sign off every commit with your commit author email (`git commit -s`). To fix the commits on this branch:',
      '',
      '    git rebase --signoff origin/main',
      '    git push --force-with-lease',
      '',
      'See CONTRIBUTING.md, "Developer Certificate of Origin".',
    );
  }
  const text = lines.join('\n');
  console.log(text);
  if (summary) appendFileSync(summary, `${text}\n`);
  if (failures.length > 0) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(`dco: ${e.message}`);
    process.exit(2);
  });
}
