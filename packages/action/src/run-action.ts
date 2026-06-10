import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  buildIngestContext,
  computeDeltas,
  createEvaluatorChain,
  createProvider,
  FileBaselineStore,
  HttpStorage,
  hasLLMJudge,
  judgeHashForProvider,
  loadConfigFromFile,
  loadSuiteFromFile,
  MemoryStorage,
  renderJUnitXml,
  Runner,
  type DeltaReport,
  type DriftConfig,
  type ProviderAdapter,
  type RunResult,
  type Suite,
} from '@drift-ci/core';

import {
  COMMENT_MARKER,
  postOrUpdateComment,
  renderComment,
  type CommentApi,
  type PrContext,
} from './comment.js';

export interface RunActionInputs {
  suite: string;
  config: string;
  provider: string;
  apiKey?: string;
  model?: string;
  threshold?: number;
  baselineSource: 'branch' | 'main';
  baselineDir: string;
  failOnRegression: boolean;
  runnerTemp: string;
  postComment: boolean;
  /** When supplied, the renderer can post or update a PR comment. */
  prContext?: PrContext;
  /** True when running against a pull_request from a forked repo. */
  isFork?: boolean;
  /** Head repository reference, for fork-skip messaging. */
  forkHeadRef?: string;
  /** Base ref used to diff .drift/baseline/ against for `baseline-changed`. */
  baseRef?: string;
  dashboardUrl?: string;
  dashboardToken?: string;
}

export interface RunActionOutputs {
  regressionCount: number;
  avgScore: number;
  runId: string;
  baselineChanged: boolean;
  junitPath: string;
  deltas: DeltaReport | null;
  run: RunResult | null;
  skipped: boolean;
}

export interface RunActionWriters {
  setOutput(name: string, value: string): void;
  info(message: string): void;
  warning(message: string): void;
  setFailed(message: string): void;
}

export interface GitOps {
  /**
   * Materialise `.drift/baseline/` from `origin/main` into a directory
   * under `runnerTemp` and return the absolute path to that directory.
   * Implementations typically shell out to `git fetch` + `git checkout`.
   */
  materialiseMainBaseline(runnerTemp: string): string;
  /**
   * List files under `.drift/baseline/` that differ between the PR head
   * and the given base ref. Used to populate the `baseline-changed`
   * output so reviewers know when a PR is bringing new baselines along.
   */
  diffBaselineFiles(baseRef: string): string[];
}

export interface RunActionDeps {
  /** Resolve a provider; tests may inject a fake. */
  providerFor?: (config: DriftConfig, inputs: RunActionInputs) => ProviderAdapter;
  /** Git operations that shell out to `git` in the Action runtime. */
  gitOps?: GitOps;
  /** Octokit-shaped comment API; tests inject a fake. Falls back to no-op when undefined. */
  commentApi?: CommentApi;
}

export async function runAction(
  inputs: RunActionInputs,
  writers: RunActionWriters,
  deps: RunActionDeps = {},
): Promise<RunActionOutputs> {
  if (inputs.dashboardUrl && !inputs.dashboardToken) {
    writers.warning(
      'drift-ci: dashboard-url is set but dashboard-token is empty. Sync will be skipped.',
    );
  }

  // Fork-PR safety gate: if we're running against a PR from a forked
  // repo AND no api-key is present, skip cleanly. Posting a friendly
  // comment is kinder than a silent no-op — see arch §8 for the
  // rationale (fork workflows can't see secrets, so a blind run would
  // always fail on the first provider call).
  if (inputs.isFork && !inputs.apiKey) {
    return handleForkSkip(inputs, writers, deps);
  }

  const loaded = loadConfigFromFile(inputs.config);
  if (loaded.notice) writers.info(loaded.notice);
  const suite = loadSuiteFromFile(inputs.suite);

  const provider = deps.providerFor
    ? deps.providerFor(loaded.config, inputs)
    : resolveProvider(loaded.config, inputs);

  const regressionThreshold =
    inputs.threshold ?? loaded.config.thresholds.regression;

  const needsJudge = hasLLMJudge(suite.evaluators);
  const judgeProvider = needsJudge
    ? resolveJudgeProvider(loaded.config, provider)
    : undefined;
  const judgeHash = judgeProvider
    ? judgeHashForProvider({ provider: judgeProvider })
    : undefined;

  const specs = suite.evaluators ?? ['exact-match'];
  const evaluatorForCase = (tc: Suite['cases'][number]) =>
    createEvaluatorChain(tc.evaluators ?? specs, {
      testProvider: provider,
      judgeProvider,
      allowSelfBias: loaded.config.judge?.allowSelfBias,
      case: tc,
    });

  const runner = new Runner({
    provider,
    evaluator: evaluatorForCase,
    storage: new MemoryStorage(),
    concurrency: loaded.config.concurrency,
    timeoutMs: loaded.config.timeoutMs,
    defaultThreshold: regressionThreshold,
  });

  writers.info(
    `drift-ci: running ${suite.cases.length} case(s) against ${provider.name} (threshold=${regressionThreshold})`,
  );
  const run = await runner.run(suite);

  const baselineRoot = resolveBaselineRoot(inputs, deps, writers);
  const baselineStore = new FileBaselineStore(baselineRoot);
  const deltas = await computeDeltas(run, suite, baselineStore, {
    defaultThreshold: regressionThreshold,
    judgeHash,
  });
  run.summary.regressions = deltas.regressions.length;

  const junitPath = resolve(inputs.runnerTemp, 'drift-junit.xml');
  mkdirSync(dirname(junitPath), { recursive: true });
  writeFileSync(junitPath, renderJUnitXml({ run, suite, deltas }));

  // Optional dashboard sync. We do this after JUnit is written so the
  // primary artifacts are durable even if the network call hangs. Errors
  // are surfaced as warnings — a downed dashboard must not block a
  // PR check.
  if (inputs.dashboardUrl && inputs.dashboardToken) {
    try {
      const httpStorage = new HttpStorage({
        url: inputs.dashboardUrl,
        token: inputs.dashboardToken,
        context: buildIngestContext(suite, judgeHash),
      });
      await httpStorage.saveRun(run);
      writers.info(
        `drift-ci: synced run ${run.id} to ${inputs.dashboardUrl}`,
      );
    } catch (err) {
      writers.warning(
        `drift-ci: dashboard sync failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const baselineChangedFiles = detectBaselineChangedFiles(inputs, deps, writers);
  const baselineChanged = baselineChangedFiles.length > 0;

  writers.setOutput('regression-count', String(deltas.regressions.length));
  writers.setOutput('avg-score', run.summary.avgScore.toFixed(3));
  writers.setOutput('run-id', run.id);
  writers.setOutput('baseline-changed', String(baselineChanged));
  writers.setOutput('junit-path', junitPath);

  writers.info(
    `drift-ci: ${run.summary.passed}/${run.summary.total} passed, ` +
      `${deltas.regressions.length} regression(s), ` +
      `avg score ${run.summary.avgScore.toFixed(3)}`,
  );

  if (inputs.postComment) {
    if (!inputs.prContext) {
      writers.info(
        'drift-ci: post-comment is true but no pull-request context was detected. Skipping comment.',
      );
    } else if (!deps.commentApi) {
      writers.warning(
        'drift-ci: post-comment is true but no GITHUB_TOKEN-backed octokit was supplied. Skipping comment.',
      );
    } else {
      const body = renderComment({
        run,
        suite,
        deltas,
        threshold: regressionThreshold,
        baselineSource: inputs.baselineSource,
        baselineChanged: baselineChangedFiles,
        dashboardUrl: inputs.dashboardUrl,
      });
      try {
        const result = await postOrUpdateComment(deps.commentApi, inputs.prContext, body);
        writers.info(
          `drift-ci: ${result.action} PR comment #${result.id} on ${inputs.prContext.owner}/${inputs.prContext.repo}#${inputs.prContext.prNumber}`,
        );
      } catch (err) {
        writers.warning(
          `drift-ci: failed to post PR comment — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (inputs.failOnRegression && deltas.regressions.length > 0) {
    writers.setFailed(
      `drift-ci: ${deltas.regressions.length} regression(s) detected: ` +
        deltas.regressions.join(', '),
    );
  }

  return {
    regressionCount: deltas.regressions.length,
    avgScore: run.summary.avgScore,
    runId: run.id,
    baselineChanged,
    junitPath,
    deltas,
    run,
    skipped: false,
  };
}

function resolveBaselineRoot(
  inputs: RunActionInputs,
  deps: RunActionDeps,
  writers: RunActionWriters,
): string {
  if (inputs.baselineSource !== 'main') return inputs.baselineDir;
  if (!deps.gitOps) {
    writers.warning(
      'drift-ci: baseline-source=main requires a GitOps implementation; falling back to baselineDir.',
    );
    return inputs.baselineDir;
  }
  try {
    const path = deps.gitOps.materialiseMainBaseline(inputs.runnerTemp);
    writers.info(`drift-ci: baseline-source=main — comparing against origin/main at ${path}`);
    return path;
  } catch (err) {
    writers.warning(
      `drift-ci: failed to materialise origin/main baseline — ${
        err instanceof Error ? err.message : String(err)
      }. Falling back to baselineDir.`,
    );
    return inputs.baselineDir;
  }
}

function detectBaselineChangedFiles(
  inputs: RunActionInputs,
  deps: RunActionDeps,
  writers: RunActionWriters,
): string[] {
  if (!deps.gitOps || !inputs.baseRef) return [];
  try {
    return deps.gitOps.diffBaselineFiles(inputs.baseRef);
  } catch (err) {
    writers.warning(
      `drift-ci: baseline-changed detection failed — ${
        err instanceof Error ? err.message : String(err)
      }. Assuming no changes.`,
    );
    return [];
  }
}

async function handleForkSkip(
  inputs: RunActionInputs,
  writers: RunActionWriters,
  deps: RunActionDeps,
): Promise<RunActionOutputs> {
  writers.info(
    `drift-ci: skipping run — pull request is from a fork (${inputs.forkHeadRef ?? 'unknown'}) and no api-key input is set. ` +
      `See SECURITY.md or the action README for the safe-to-run-llm-tests label pattern.`,
  );

  writers.setOutput('regression-count', '0');
  writers.setOutput('avg-score', '0.000');
  writers.setOutput('run-id', 'skipped');
  writers.setOutput('baseline-changed', 'false');
  writers.setOutput('junit-path', '');

  if (inputs.postComment && inputs.prContext && deps.commentApi) {
    const body = renderForkSkipComment(inputs);
    try {
      const result = await postOrUpdateComment(deps.commentApi, inputs.prContext, body);
      writers.info(
        `drift-ci: ${result.action} fork-skip PR comment #${result.id} on ${inputs.prContext.owner}/${inputs.prContext.repo}#${inputs.prContext.prNumber}`,
      );
    } catch (err) {
      writers.warning(
        `drift-ci: failed to post fork-skip comment — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    regressionCount: 0,
    avgScore: 0,
    runId: 'skipped',
    baselineChanged: false,
    junitPath: '',
    deltas: null,
    run: null,
    skipped: true,
  };
}

function renderForkSkipComment(inputs: RunActionInputs): string {
  const forkRef = inputs.forkHeadRef ?? 'a forked repository';
  return [
    COMMENT_MARKER,
    '## ⏭️ drift-ci — skipped',
    '',
    `This pull request is from \`${forkRef}\` and no provider \`api-key\` was passed to the action. ` +
      'GitHub does not pass repository secrets to workflows triggered by `pull_request` events from forks — by design, ' +
      'so a malicious fork cannot exfiltrate your provider keys.',
    '',
    '### Maintainer next steps',
    '',
    '1. Review the fork diff carefully.',
    '2. If the change is safe, apply the `safe-to-run-llm-tests` label to this PR.',
    '3. Re-run drift-ci from a `pull_request_target` workflow (see the action README for the full gated template).',
    '',
    '<sub>drift-ci exits cleanly on fork PRs without keys rather than failing the check — this keeps external contributions reviewable without leaking secrets.</sub>',
  ].join('\n');
}

function resolveProvider(
  config: DriftConfig,
  inputs: RunActionInputs,
): ProviderAdapter {
  return createProvider({
    name: inputs.provider,
    model: inputs.model ?? config.provider.model,
    apiKey: inputs.apiKey,
    baseUrl: config.provider.baseUrl,
    region: config.provider.region,
    mock: config.provider.mock,
  });
}

function resolveJudgeProvider(
  config: DriftConfig,
  fallback: ProviderAdapter,
): ProviderAdapter {
  const judge = config.judge;
  if (!judge || (!judge.provider && !judge.model)) return fallback;
  return createProvider({
    name: judge.provider ?? config.provider.name,
    model: judge.model ?? config.provider.model,
    apiKey: judge.apiKey,
    baseUrl: judge.baseUrl ?? config.provider.baseUrl,
    region: config.provider.region,
  });
}
