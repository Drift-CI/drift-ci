import type { IngestGit } from '@drift-ci/core';

/** The slice of @actions/github's `context` this module reads (kept structural so tests need no Actions env). */
export interface GitHubContextLike {
  eventName: string;
  sha: string;
  ref: string;
  repo: { owner: string; repo: string };
  payload: {
    pull_request?: { number: number; title?: string; html_url?: string; head?: { ref?: string; sha?: string } };
    repository?: { default_branch?: string };
  };
}

const KNOWN_EVENTS = new Set(['pull_request', 'push', 'schedule', 'workflow_dispatch']);
const MAX_TITLE = 300;

/** Pure: where this run came from, for the dashboard (alerts, run page). Undefined when the context is incomplete. */
export function buildGitContext(ctx: GitHubContextLike): IngestGit | undefined {
  if (!ctx.repo?.owner || !ctx.repo?.repo || !ctx.sha) return undefined;
  const pr = ctx.payload.pull_request;
  const eventName = ctx.eventName === 'pull_request_target' ? 'pull_request' : ctx.eventName;
  const event = KNOWN_EVENTS.has(eventName) ? eventName : 'other';
  const ref = pr?.head?.ref ?? ctx.ref.replace(/^refs\/(heads|tags)\//, '');
  const defaultBranch = ctx.payload.repository?.default_branch;
  const git: IngestGit = {
    repo: `${ctx.repo.owner}/${ctx.repo.repo}`,
    sha: pr?.head?.sha ?? ctx.sha,
    ref,
    event,
    // The schedule payload has no `repository`, but scheduled workflows always run on the default branch.
    isDefaultBranch: event === 'schedule' || (!pr && !!defaultBranch && ref === defaultBranch),
  };
  if (pr) {
    git.pr = {
      number: pr.number,
      title: (pr.title ?? '').slice(0, MAX_TITLE),
      url: pr.html_url ?? `https://github.com/${ctx.repo.owner}/${ctx.repo.repo}/pull/${pr.number}`,
    };
  }
  return git;
}
