import { describe, expect, it } from 'vitest';
import { buildGitContext, type GitHubContextLike } from '../git-context.js';

const base = (o: Partial<GitHubContextLike> = {}): GitHubContextLike => ({
  eventName: 'push', sha: 'sha-merge', ref: 'refs/heads/main',
  repo: { owner: 'acme', repo: 'bot' },
  payload: { repository: { default_branch: 'main' } },
  ...o,
});

describe('buildGitContext', () => {
  it('push to the default branch', () => {
    expect(buildGitContext(base())).toEqual({ repo: 'acme/bot', sha: 'sha-merge', ref: 'main', event: 'push', isDefaultBranch: true });
  });
  it('push to a feature branch is not the default branch', () => {
    expect(buildGitContext(base({ ref: 'refs/heads/feat/x' }))).toMatchObject({ ref: 'feat/x', isDefaultBranch: false });
  });
  it('pull_request uses the head branch and sha and includes the PR', () => {
    const g = buildGitContext(base({
      eventName: 'pull_request', ref: 'refs/pull/14/merge',
      payload: { repository: { default_branch: 'main' }, pull_request: { number: 14, title: 'perf: haiku', html_url: 'https://github.com/acme/bot/pull/14', head: { ref: 'perf/haiku', sha: 'sha-head' } } },
    }));
    expect(g).toEqual({ repo: 'acme/bot', sha: 'sha-head', ref: 'perf/haiku', event: 'pull_request', isDefaultBranch: false,
      pr: { number: 14, title: 'perf: haiku', url: 'https://github.com/acme/bot/pull/14' } });
  });
  it('pull_request_target is reported as pull_request', () => {
    const g = buildGitContext(base({ eventName: 'pull_request_target', payload: { pull_request: { number: 2, head: { ref: 'f' } } } }));
    expect(g?.event).toBe('pull_request');
    expect(g?.pr).toEqual({ number: 2, title: '', url: 'https://github.com/acme/bot/pull/2' });
  });
  it('schedule on the default branch', () => {
    expect(buildGitContext(base({ eventName: 'schedule' }))).toMatchObject({ event: 'schedule', isDefaultBranch: true });
  });
  it('unknown events become "other"', () => {
    expect(buildGitContext(base({ eventName: 'release' }))?.event).toBe('other');
  });
  it('truncates very long PR titles to 300 characters', () => {
    const g = buildGitContext(base({ eventName: 'pull_request', payload: { pull_request: { number: 1, title: 'x'.repeat(500) } } }));
    expect(g?.pr?.title).toHaveLength(300);
  });
  it('returns undefined without a repo or sha', () => {
    expect(buildGitContext(base({ sha: '' }))).toBeUndefined();
    expect(buildGitContext(base({ repo: { owner: '', repo: '' } }))).toBeUndefined();
  });
});
