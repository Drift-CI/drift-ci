import * as core from '@actions/core';
import * as github from '@actions/github';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  runAction,
  type GitOps,
  type RunActionDeps,
  type RunActionInputs,
  type RunActionWriters,
} from './run-action.js';
import type { CommentApi, PrContext } from './comment.js';

/* c8 ignore start -- thin @actions/core glue; exercised by the end-to-end action workflow, not by unit tests. */
function readInputs(
  prContext: PrContext | undefined,
  isFork: boolean,
  forkHeadRef: string | undefined,
  baseRef: string | undefined,
): RunActionInputs {
  const runnerTemp = process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? process.env.TEMP ?? '/tmp';
  const thresholdRaw = core.getInput('threshold');
  const threshold = thresholdRaw ? Number.parseFloat(thresholdRaw) : undefined;
  const baselineSourceRaw = (core.getInput('baseline-source') || 'branch') as string;
  const baselineSource: 'branch' | 'main' =
    baselineSourceRaw === 'main' ? 'main' : 'branch';
  return {
    suite: core.getInput('suite') || '.drift/suite.yaml',
    config: core.getInput('config') || '.drift/config.yaml',
    provider: core.getInput('provider', { required: true }),
    apiKey: core.getInput('api-key') || undefined,
    model: core.getInput('model') || undefined,
    threshold,
    baselineSource,
    baselineDir: '.drift/baseline',
    failOnRegression: core.getBooleanInput('fail-on-regression'),
    runnerTemp,
    postComment: core.getBooleanInput('post-comment'),
    prContext,
    isFork,
    forkHeadRef,
    baseRef,
    dashboardUrl: core.getInput('dashboard-url') || undefined,
    dashboardToken: core.getInput('dashboard-token') || undefined,
  };
}

interface PrPayloadHeadRepo {
  fork?: boolean;
  full_name?: string;
}

interface PrPayload {
  number: number;
  head?: { ref?: string; repo?: PrPayloadHeadRepo };
  base?: { ref?: string };
}

function detectPrContext(): {
  prContext: PrContext | undefined;
  isFork: boolean;
  forkHeadRef: string | undefined;
  baseRef: string | undefined;
} {
  const pr = github.context.payload.pull_request as PrPayload | undefined;
  if (!pr) return { prContext: undefined, isFork: false, forkHeadRef: undefined, baseRef: undefined };
  const isFork = pr.head?.repo?.fork === true;
  const forkHeadRef = isFork ? pr.head?.repo?.full_name : undefined;
  const baseRef = pr.base?.ref;
  return {
    prContext: {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      prNumber: pr.number,
    },
    isFork,
    forkHeadRef,
    baseRef,
  };
}

function buildCommentApi(): CommentApi | undefined {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return undefined;
  const octokit = github.getOctokit(token);
  return {
    list: async ({ owner, repo, issueNumber }) => {
      const { data } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
      });
      return data.map((c) => ({ id: c.id, body: c.body }));
    },
    update: async ({ owner, repo, commentId, body }) => {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: commentId,
        body,
      });
    },
    create: async ({ owner, repo, issueNumber, body }) => {
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
      return { id: data.id };
    },
  };
}

function buildGitOps(): GitOps {
  return {
    materialiseMainBaseline(runnerTemp: string): string {
      const targetDir = join(runnerTemp, 'drift-main-baseline');
      mkdirSync(targetDir, { recursive: true });
      execFileSync('git', ['fetch', 'origin', 'main', '--depth=1'], {
        stdio: 'inherit',
      });
      // --work-tree isolates the checkout under targetDir so we don't
      // clobber the PR's on-disk .drift/baseline/.
      execFileSync(
        'git',
        ['--work-tree', targetDir, 'checkout', 'origin/main', '--', '.drift/baseline'],
        { stdio: 'inherit' },
      );
      return join(targetDir, '.drift', 'baseline');
    },
    diffBaselineFiles(baseRef: string): string[] {
      const out = execFileSync(
        'git',
        ['diff', '--name-only', `origin/${baseRef}...HEAD`, '--', '.drift/baseline/'],
        { encoding: 'utf8' },
      );
      return out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    },
  };
}

const writers: RunActionWriters = {
  setOutput: (name, value) => core.setOutput(name, value),
  info: (msg) => core.info(msg),
  warning: (msg) => core.warning(msg),
  setFailed: (msg) => core.setFailed(msg),
};

const { prContext, isFork, forkHeadRef, baseRef } = detectPrContext();
const deps: RunActionDeps = {
  commentApi: buildCommentApi(),
  gitOps: buildGitOps(),
};

runAction(readInputs(prContext, isFork, forkHeadRef, baseRef), writers, deps).catch(
  (err: unknown) => {
    core.setFailed(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
/* c8 ignore stop */
