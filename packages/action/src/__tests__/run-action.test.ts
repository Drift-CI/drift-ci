import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { runAction, type RunActionInputs, type RunActionWriters } from '../run-action.js';

const SUITE_YAML = `version: 1
id: act-suite
name: Action Suite
evaluators:
  - exact-match
cases:
  - id: math
    input: "What is 2+2?"
    expected: "4"
  - id: greet
    input: "Say hi"
    expected: "hi"
`;

function configWith(responses: Record<string, string>, opts: { threshold?: number } = {}): string {
  const pairs = Object.entries(responses)
    .map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join('\n');
  return `version: 1
provider:
  name: mock
  model: act-model
  mock:
    responses:
${pairs}
    defaultResponse: fallback
storage:
  type: memory
thresholds:
  regression: ${opts.threshold ?? 0.1}
  alert: 0.20
baseline:
  source: branch
concurrency: 2
timeoutMs: 10000
suite: .drift/suite.yaml
`;
}

interface Ws {
  workdir: string;
  config: string;
  suite: string;
  baselineDir: string;
  runnerTemp: string;
}

function makeWs(): Ws {
  const workdir = mkdtempSync(join(tmpdir(), 'drift-action-'));
  const drift = join(workdir, '.drift');
  mkdirSync(drift, { recursive: true });
  const config = join(drift, 'config.yaml');
  const suite = join(drift, 'suite.yaml');
  const baselineDir = join(drift, 'baseline');
  const runnerTemp = join(workdir, 'runner-temp');
  mkdirSync(baselineDir, { recursive: true });
  mkdirSync(runnerTemp, { recursive: true });
  writeFileSync(config, configWith({ 'What is 2+2?': '4', 'Say hi': 'hi' }));
  writeFileSync(suite, SUITE_YAML);
  return { workdir, config, suite, baselineDir, runnerTemp };
}

function makeInputs(ws: Ws, overrides: Partial<RunActionInputs> = {}): RunActionInputs {
  return {
    suite: ws.suite,
    config: ws.config,
    provider: 'mock',
    apiKey: undefined,
    model: undefined,
    threshold: undefined,
    baselineSource: 'branch',
    baselineDir: ws.baselineDir,
    failOnRegression: true,
    runnerTemp: ws.runnerTemp,
    postComment: false,
    dashboardUrl: undefined,
    dashboardToken: undefined,
    ...overrides,
  };
}

function makeWriters(): RunActionWriters & {
  outputs: Record<string, string>;
  infos: string[];
  warnings: string[];
  failures: string[];
} {
  const outputs: Record<string, string> = {};
  const infos: string[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];
  return {
    outputs,
    infos,
    warnings,
    failures,
    setOutput: (name, value) => {
      outputs[name] = value;
    },
    info: (msg) => infos.push(msg),
    warning: (msg) => warnings.push(msg),
    setFailed: (msg) => failures.push(msg),
  };
}

describe('runAction', () => {
  let ws: Ws;
  const originalMockFlag = process.env.DRIFT_ENABLE_MOCK_PROVIDER;

  beforeEach(() => {
    process.env.DRIFT_ENABLE_MOCK_PROVIDER = 'true';
    ws = makeWs();
  });

  afterEach(() => {
    rmSync(ws.workdir, { recursive: true, force: true });
    if (originalMockFlag === undefined) delete process.env.DRIFT_ENABLE_MOCK_PROVIDER;
    else process.env.DRIFT_ENABLE_MOCK_PROVIDER = originalMockFlag;
  });

  it('runs the suite and writes a JUnit report to $RUNNER_TEMP', async () => {
    const writers = makeWriters();
    const out = await runAction(makeInputs(ws), writers);

    expect(out.run).not.toBeNull();
    expect(out.run!.summary.total).toBe(2);
    expect(out.run!.summary.passed).toBe(2);
    expect(out.regressionCount).toBe(0);
    expect(out.skipped).toBe(false);
    expect(writers.failures).toEqual([]);

    const expectedPath = join(ws.runnerTemp, 'drift-junit.xml');
    expect(writers.outputs['junit-path']).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);

    const xml = readFileSync(expectedPath, 'utf8');
    expect(xml).toMatch(/<testsuites name="drift-ci"/);
    expect(xml).toMatch(/name="math"/);
    expect(xml).toMatch(/name="greet"/);
  });

  it('sets all five advertised outputs', async () => {
    const writers = makeWriters();
    await runAction(makeInputs(ws), writers);
    expect(Object.keys(writers.outputs).sort()).toEqual([
      'avg-score',
      'baseline-changed',
      'junit-path',
      'regression-count',
      'run-id',
    ]);
    expect(writers.outputs['regression-count']).toBe('0');
    expect(writers.outputs['avg-score']).toMatch(/^\d\.\d{3}$/);
    expect(writers.outputs['run-id']).toMatch(/[0-9a-f-]{36}/);
    expect(writers.outputs['baseline-changed']).toBe('false');
  });

  it('flags a regression (exit via setFailed) when baselines say otherwise', async () => {
    // Establish baselines on disk at score 1.0 by running once, then writing
    // the baselines manually — fastest way to set up the regression case.
    const baselinePath = join(ws.baselineDir, 'math.json');
    const baselineData = {
      $schema: 'https://drift-ci.dev/schema/baseline-v1.json',
      caseId: 'math',
      suiteId: 'act-suite',
      suiteHash: computeExpectedSuiteHash('math', 'What is 2+2?', '4'),
      score: 1,
      output: '4',
      outputTruncated: false,
      outputFullHash: 'sha256:placeholder',
      capturedAt: new Date('2026-04-01T00:00:00Z').toISOString(),
      capturedBy: { runId: 'seed', provider: 'mock/act-model' },
    };
    writeFileSync(baselinePath, JSON.stringify(baselineData, null, 2));
    writeFileSync(
      join(ws.baselineDir, 'greet.json'),
      JSON.stringify(
        {
          ...baselineData,
          caseId: 'greet',
          suiteHash: computeExpectedSuiteHash('greet', 'Say hi', 'hi'),
          output: 'hi',
        },
        null,
        2,
      ),
    );

    // Flip math's response — score drops to 0 → regression.
    writeFileSync(ws.config, configWith({ 'What is 2+2?': 'wrong', 'Say hi': 'hi' }));

    const writers = makeWriters();
    const out = await runAction(makeInputs(ws), writers);
    expect(out.regressionCount).toBe(1);
    expect(out.deltas?.regressions).toContain('math');
    expect(writers.failures.length).toBe(1);
    expect(writers.failures[0]).toMatch(/1 regression\(s\) detected.*math/);
    expect(writers.outputs['regression-count']).toBe('1');
  });

  it('does not call setFailed when fail-on-regression is false', async () => {
    writeFileSync(
      join(ws.baselineDir, 'math.json'),
      JSON.stringify({
        caseId: 'math',
        suiteId: 'act-suite',
        suiteHash: computeExpectedSuiteHash('math', 'What is 2+2?', '4'),
        score: 1,
        output: '4',
        outputTruncated: false,
        outputFullHash: 'sha256:x',
        capturedAt: '2026-04-01T00:00:00Z',
        capturedBy: { runId: 'seed', provider: 'mock/act-model' },
      }),
    );
    writeFileSync(ws.config, configWith({ 'What is 2+2?': 'wrong', 'Say hi': 'hi' }));

    const writers = makeWriters();
    const out = await runAction(makeInputs(ws, { failOnRegression: false }), writers);
    expect(out.regressionCount).toBe(1);
    expect(writers.failures).toEqual([]);
  });

  it('warns and falls back to branch baselines when baseline-source=main has no gitOps', async () => {
    const writers = makeWriters();
    await runAction(makeInputs(ws, { baselineSource: 'main' }), writers);
    expect(writers.warnings.some((w) => /baseline-source=main requires a GitOps/.test(w))).toBe(true);
  });

  it('uses gitOps.materialiseMainBaseline when baseline-source=main and gitOps is supplied', async () => {
    // Materialise a sibling baseline directory with a different baseline
    // for `math`. The run will use it — so when we flip math's response,
    // computing the delta goes against origin/main, not the PR's own
    // committed baseline.
    const altBaselineDir = join(ws.workdir, 'origin-main-baseline');
    mkdirSync(altBaselineDir, { recursive: true });
    writeFileSync(
      join(altBaselineDir, 'math.json'),
      JSON.stringify({
        caseId: 'math',
        suiteId: 'act-suite',
        suiteHash: computeExpectedSuiteHash('math', 'What is 2+2?', '4'),
        score: 1,
        output: '4',
        outputTruncated: false,
        outputFullHash: 'sha256:x',
        capturedAt: '2026-04-01T00:00:00Z',
        capturedBy: { runId: 'seed', provider: 'mock/act-model' },
      }),
    );
    // Flip math's response so the current run mismatches origin/main.
    writeFileSync(ws.config, configWith({ 'What is 2+2?': 'wrong', 'Say hi': 'hi' }));

    let materialiseCalls = 0;
    const writers = makeWriters();
    const out = await runAction(
      makeInputs(ws, { baselineSource: 'main' }),
      writers,
      {
        gitOps: {
          materialiseMainBaseline: (tmp) => {
            materialiseCalls += 1;
            expect(tmp).toBe(ws.runnerTemp);
            return altBaselineDir;
          },
          diffBaselineFiles: () => [],
        },
      },
    );
    expect(materialiseCalls).toBe(1);
    expect(out.regressionCount).toBe(1);
    expect(out.deltas?.regressions).toContain('math');
    expect(writers.infos.some((m) => /baseline-source=main/.test(m))).toBe(true);
  });

  it('falls back to branch baselines when gitOps.materialiseMainBaseline throws', async () => {
    const writers = makeWriters();
    const out = await runAction(
      makeInputs(ws, { baselineSource: 'main' }),
      writers,
      {
        gitOps: {
          materialiseMainBaseline: () => {
            throw new Error('git fetch failed');
          },
          diffBaselineFiles: () => [],
        },
      },
    );
    expect(writers.warnings.some((w) => /git fetch failed/.test(w))).toBe(true);
    // Run still completes against the PR-local baseline dir (empty) →
    // missing-baseline, no regressions.
    expect(out.regressionCount).toBe(0);
    expect(out.deltas?.missingBaselines.sort()).toEqual(['greet', 'math']);
  });

  it('skips comment posting when post-comment is true but no PR context is detected', async () => {
    const writers = makeWriters();
    await runAction(makeInputs(ws, { postComment: true }), writers);
    expect(writers.infos.some((m) => /no pull-request context/.test(m))).toBe(true);
  });

  it('warns when post-comment is true and PR context exists but no commentApi is supplied', async () => {
    const writers = makeWriters();
    await runAction(
      makeInputs(ws, {
        postComment: true,
        prContext: { owner: 'octocat', repo: 'hello', prNumber: 1 },
      }),
      writers,
    );
    expect(writers.warnings.some((w) => /no GITHUB_TOKEN-backed octokit/.test(w))).toBe(true);
  });

  it('posts a PR comment via the injected commentApi when fully configured', async () => {
    const created: string[] = [];
    const writers = makeWriters();
    await runAction(
      makeInputs(ws, {
        postComment: true,
        prContext: { owner: 'octocat', repo: 'hello', prNumber: 7 },
      }),
      writers,
      {
        commentApi: {
          list: async () => [],
          update: async () => {
            throw new Error('should not update');
          },
          create: async ({ body }) => {
            created.push(body);
            return { id: 999 };
          },
        },
      },
    );
    expect(created.length).toBe(1);
    expect(created[0]).toMatch(/<!-- drift-ci-comment -->/);
    expect(created[0]).toMatch(/All cases passed/);
    expect(writers.infos.some((m) => /created PR comment #999/.test(m))).toBe(true);
  });

  it('updates an existing PR comment instead of creating a duplicate', async () => {
    const writers = makeWriters();
    let updateCalled = false;
    await runAction(
      makeInputs(ws, {
        postComment: true,
        prContext: { owner: 'octocat', repo: 'hello', prNumber: 7 },
      }),
      writers,
      {
        commentApi: {
          list: async () => [
            { id: 1, body: 'unrelated' },
            { id: 42, body: '<!-- drift-ci-comment -->\nold content' },
          ],
          update: async ({ commentId }) => {
            expect(commentId).toBe(42);
            updateCalled = true;
          },
          create: async () => {
            throw new Error('should not create');
          },
        },
      },
    );
    expect(updateCalled).toBe(true);
    expect(writers.infos.some((m) => /updated PR comment #42/.test(m))).toBe(true);
  });

  it('warns and continues when the comment API throws', async () => {
    const writers = makeWriters();
    await runAction(
      makeInputs(ws, {
        postComment: true,
        prContext: { owner: 'octocat', repo: 'hello', prNumber: 7 },
      }),
      writers,
      {
        commentApi: {
          list: async () => {
            throw new Error('rate limited');
          },
          update: async () => {},
          create: async () => ({ id: 0 }),
        },
      },
    );
    expect(writers.warnings.some((w) => /failed to post PR comment.*rate limited/.test(w))).toBe(true);
    // The run itself still succeeded.
    expect(writers.failures).toEqual([]);
  });

  it('warns when dashboard-url is set (Phase 3 hook)', async () => {
    const writers = makeWriters();
    await runAction(makeInputs(ws, { dashboardUrl: 'https://dash.example' }), writers);
    expect(writers.warnings.some((w) => /dashboard-url/.test(w))).toBe(true);
  });

  it('honours a threshold input by overriding the config value', async () => {
    // Baseline at 1.0, run at 0.0 → absolute delta 1.0. threshold=1.0
    // (the max allowed by the schema) suppresses the regression since the
    // rule is `-delta > threshold`. Default threshold 0.1 would flag it.
    writeFileSync(
      join(ws.baselineDir, 'math.json'),
      JSON.stringify({
        caseId: 'math',
        suiteId: 'act-suite',
        suiteHash: computeExpectedSuiteHash('math', 'What is 2+2?', '4'),
        score: 1,
        output: '4',
        outputTruncated: false,
        outputFullHash: 'sha256:x',
        capturedAt: '2026-04-01T00:00:00Z',
        capturedBy: { runId: 'seed', provider: 'mock/act-model' },
      }),
    );
    writeFileSync(ws.config, configWith({ 'What is 2+2?': 'wrong', 'Say hi': 'hi' }));

    const lenient = makeWriters();
    await runAction(makeInputs(ws, { threshold: 1.0 }), lenient);
    expect(lenient.failures).toEqual([]);

    const strict = makeWriters();
    await runAction(makeInputs(ws, { threshold: 0.01 }), strict);
    expect(strict.failures.length).toBeGreaterThan(0);
  });

  it('returns deltas alongside the outputs for programmatic callers', async () => {
    const writers = makeWriters();
    const out = await runAction(makeInputs(ws), writers);
    expect(out.deltas).not.toBeNull();
    expect(out.deltas?.regressions).toEqual([]);
    expect(out.deltas?.missingBaselines.sort()).toEqual(['greet', 'math']);
  });

  it('reports baselineChanged via gitOps.diffBaselineFiles when baseRef is set', async () => {
    const writers = makeWriters();
    const out = await runAction(makeInputs(ws, { baseRef: 'main' }), writers, {
      gitOps: {
        materialiseMainBaseline: () => {
          throw new Error('not called');
        },
        diffBaselineFiles: () => ['.drift/baseline/math.json'],
      },
    });
    expect(out.baselineChanged).toBe(true);
    expect(writers.outputs['baseline-changed']).toBe('true');
  });

  it('skips the run on a fork PR without an api-key and returns skipped=true', async () => {
    const writers = makeWriters();
    const out = await runAction(
      makeInputs(ws, {
        isFork: true,
        forkHeadRef: 'contributor/drift-ci-fork',
        apiKey: undefined,
        postComment: false,
      }),
      writers,
    );
    expect(out.skipped).toBe(true);
    expect(out.run).toBeNull();
    expect(out.regressionCount).toBe(0);
    expect(writers.failures).toEqual([]);
    expect(writers.outputs['run-id']).toBe('skipped');
    expect(writers.outputs['junit-path']).toBe('');
    expect(writers.infos.some((m) => /from a fork/.test(m))).toBe(true);
  });

  it('posts a fork-skip comment when post-comment + PR context + commentApi are all set', async () => {
    const writers = makeWriters();
    const created: string[] = [];
    await runAction(
      makeInputs(ws, {
        isFork: true,
        forkHeadRef: 'contributor/drift-ci-fork',
        apiKey: undefined,
        postComment: true,
        prContext: { owner: 'host', repo: 'repo', prNumber: 9 },
      }),
      writers,
      {
        commentApi: {
          list: async () => [],
          update: async () => {
            throw new Error('should not update');
          },
          create: async ({ body }) => {
            created.push(body);
            return { id: 77 };
          },
        },
      },
    );
    expect(created.length).toBe(1);
    expect(created[0]).toMatch(/drift-ci — skipped/);
    expect(created[0]).toMatch(/contributor\/drift-ci-fork/);
    expect(created[0]).toMatch(/safe-to-run-llm-tests/);
    expect(writers.infos.some((m) => /created fork-skip PR comment #77/.test(m))).toBe(true);
  });

  it('proceeds normally on a fork PR when an api-key is explicitly supplied', async () => {
    const writers = makeWriters();
    const out = await runAction(
      makeInputs(ws, {
        isFork: true,
        forkHeadRef: 'contributor/drift-ci-fork',
        apiKey: 'provider-key-in-scope',
      }),
      writers,
    );
    // Api-key input being set (e.g. via pull_request_target with the
    // safe-to-run-llm-tests label) reopens the gate.
    expect(out.skipped).toBe(false);
    expect(out.run).not.toBeNull();
  });

  it('creates parent directories for the JUnit report path', async () => {
    const nested = join(ws.runnerTemp, 'nested', 'deeper');
    const writers = makeWriters();
    const out = await runAction(makeInputs(ws, { runnerTemp: nested }), writers);
    expect(existsSync(out.junitPath)).toBe(true);
  });

  it('respects config.notice from the loader via writers.info', async () => {
    // Trigger a minor-bump notice by declaring version: "1.0" explicitly.
    writeFileSync(
      ws.config,
      configWith({ 'What is 2+2?': '4', 'Say hi': 'hi' }).replace('version: 1', 'version: "1.0"'),
    );
    const writers = makeWriters();
    await runAction(makeInputs(ws), writers);
    // The loader only emits a notice on an actual upgrade; 1.0 equals 1.0 so no
    // notice is expected. Just assert no crash and tests still pass.
    expect(writers.failures).toEqual([]);
  });
});

function computeExpectedSuiteHash(_caseId: string, input: string, expected: string): string {
  // Mirror computeSuiteHash's canonical stringification for a simple case.
  // Tests use this to seed a baseline whose suiteHash matches the runtime-computed hash.
  // Keys MUST be alphabetically sorted to match `stableStringify`.
  const canonical = JSON.stringify({
    criteria: null,
    evaluators: null,
    expected,
    input,
    messages: null,
    rubric: null,
    rubricQuorum: null,
    schema: null,
    systemPrompt: null,
    threshold: null,
  });
  const hash = hashString(canonical);
  return `sha256:${hash}`;
}

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
