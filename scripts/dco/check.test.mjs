// Run with: node --test "scripts/dco/*.test.mjs"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCommits } from './check.mjs';

/** A commit as GET /repos/{owner}/{repo}/pulls/{n}/commits returns it, trimmed to the fields we read. */
const commit = ({ sha = 'a'.repeat(40), email = 'dev@example.com', message = 'feat: x', parents = 1, login = 'dev', type = 'User' } = {}) => ({
  sha,
  commit: { message, author: { name: 'Dev', email } },
  author: login === null ? null : { login, type },
  parents: Array.from({ length: parents }, (_, i) => ({ sha: String(i) })),
});

test('passes a commit signed off with the author email', () => {
  const r = checkCommits([commit({ message: 'feat: x\n\nSigned-off-by: Dev <dev@example.com>' })]);
  assert.deepEqual(r.failures, []);
  assert.equal(r.checked, 1);
});

test('matches the email case-insensitively and accepts any one of several trailers', () => {
  const r = checkCommits([
    commit({ email: 'Dev@Example.com', message: 'x\n\nSigned-off-by: Someone <other@example.com>\nSigned-off-by: Dev <dev@example.COM>' }),
  ]);
  assert.deepEqual(r.failures, []);
});

test('fails a commit with no sign-off', () => {
  const r = checkCommits([commit({ sha: 'b'.repeat(40), message: 'fix: y' })]);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].sha, 'b'.repeat(40));
  assert.match(r.failures[0].reason, /no Signed-off-by/);
});

test('fails a sign-off for a different email than the author', () => {
  const r = checkCommits([commit({ message: 'fix: y\n\nSigned-off-by: Dev <someone-else@example.com>' })]);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0].reason, /dev@example\.com/);
});

test('ignores a Signed-off-by that is not a whole trailer line', () => {
  const r = checkCommits([commit({ message: 'fix: mention Signed-off-by: Dev <dev@example.com> inline' })]);
  assert.equal(r.failures.length, 1);
});

test('skips merge commits and bot-authored commits', () => {
  const r = checkCommits([
    commit({ parents: 2, message: "Merge branch 'main' into feature" }),
    commit({ login: 'github-actions[bot]', type: 'Bot', message: 'build: sync dist bundle' }),
    commit({ login: 'dependabot[bot]', type: 'Bot', message: 'chore(deps): bump x' }),
  ]);
  assert.deepEqual(r.failures, []);
  assert.equal(r.checked, 0);
  assert.equal(r.skipped, 3);
});

test('a commit whose author has no GitHub account is still checked', () => {
  const r = checkCommits([commit({ login: null, message: 'docs: z' })]);
  assert.equal(r.failures.length, 1);
});
