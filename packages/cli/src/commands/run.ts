import type { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildIngestContext,
  computeDeltas,
  createEvaluatorChain,
  createProvider,
  createStorage,
  FileBaselineStore,
  hasLLMJudge,
  judgeHashForProvider,
  loadConfigFromFile,
  loadSuiteFromFile,
  Runner,
  renderJUnitXml,
  type DeltaReport,
  type DriftConfig,
  type ProviderAdapter,
} from '@drift-ci/core';

import { createReporter, type ReporterKind } from '../reporters/index.js';

export interface RunOptions {
  config: string;
  suite?: string;
  provider?: string;
  model?: string;
  baselineDir: string;
  runsDir: string;
  // Commander stores the lone `--no-baseline` flag under `baseline`
  // (default true; false when the flag is passed) — not `noBaseline`.
  baseline?: boolean;
  reporter: ReporterKind;
  junitPath?: string;
}

/* c8 ignore start -- Commander wiring; covered by the CLI E2E in a subprocess. */
export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Run a drift-ci suite')
    .argument('[suite]', 'path to suite.yaml (overrides config)')
    .option('--config <path>', 'drift-ci config path', '.drift/config.yaml')
    .option('--suite <path>', 'suite yaml path (overrides config)')
    .option('-p, --provider <name>', 'override provider from config')
    .option('-m, --model <name>', 'override model from config')
    .option('--baseline-dir <path>', 'baseline directory', '.drift/baseline')
    .option('--runs-dir <path>', 'runs directory', '.drift/runs')
    .option('--no-baseline', 'skip baseline comparison for this run')
    .option(
      '--reporter <kind>',
      'output format: terminal (human) or json (tooling)',
      'terminal',
    )
    .option(
      '--junit-path <path>',
      'also write a JUnit XML report to this path (suitable for GitLab CI / Jenkins)',
    )
    .action(async (positionalSuite: string | undefined, opts: RunOptions) => {
      if (opts.reporter !== 'terminal' && opts.reporter !== 'json') {
        console.error(
          `drift-ci: unknown --reporter '${opts.reporter}'. Use 'terminal' or 'json'.`,
        );
        process.exit(1);
      }
      const exitCode = await executeRun(positionalSuite, opts);
      if (exitCode !== 0) process.exit(exitCode);
    });
}
/* c8 ignore stop */

export async function executeRun(
  positionalSuite: string | undefined,
  opts: RunOptions,
): Promise<number> {
  const loaded = loadConfigFromFile(opts.config);
  if (loaded.notice) console.error(loaded.notice);

  const suitePath = positionalSuite ?? opts.suite ?? loaded.config.suite;
  const suite = loadSuiteFromFile(suitePath);

  const provider = resolveProvider(loaded.config, opts);

  // Precompute the HTTP ingest context up front so `http` storage can
  // enrich POST /api/v1/runs with per-case suiteHash + judgeHash. No-op
  // for other storage types.
  const needsJudge = hasLLMJudge(suite.evaluators);
  const judgeProvider = needsJudge
    ? resolveJudgeProvider(loaded.config, provider)
    : undefined;
  const judgeHash = judgeProvider
    ? judgeHashForProvider({ provider: judgeProvider })
    : undefined;
  const httpContext =
    loaded.config.storage?.type === 'http'
      ? buildIngestContext(suite, judgeHash)
      : undefined;

  const storage = await createStorage(loaded.config, {
    runsDir: opts.runsDir,
    httpContext,
  });
  try {
    return await runWithStorage(suite, provider, judgeProvider, judgeHash, storage, loaded, opts);
  } finally {
    await storage.close();
  }
}

async function runWithStorage(
  suite: ReturnType<typeof loadSuiteFromFile>,
  provider: ProviderAdapter,
  judgeProvider: ProviderAdapter | undefined,
  judgeHash: string | undefined,
  storage: Awaited<ReturnType<typeof createStorage>>,
  loaded: ReturnType<typeof loadConfigFromFile>,
  opts: RunOptions,
): Promise<number> {
  const specs = suite.evaluators ?? ['exact-match'];
  const evaluatorForCase = (tc: typeof suite.cases[number]) =>
    createEvaluatorChain(tc.evaluators ?? specs, {
      testProvider: provider,
      judgeProvider,
      allowSelfBias: loaded.config.judge?.allowSelfBias,
      case: tc,
    });

  const reporter = createReporter({
    kind: opts.reporter,
    stdoutIsTty: Boolean(process.stdout.isTTY),
  });

  await reporter.onRunStart({ suite, provider: provider.name });

  const runner = new Runner({
    provider,
    evaluator: evaluatorForCase,
    storage,
    concurrency: loaded.config.concurrency,
    timeoutMs: loaded.config.timeoutMs,
    defaultThreshold: loaded.config.thresholds.regression,
    onCaseComplete: (cr) => {
      void reporter.onCaseComplete(cr);
    },
  });

  const run = await runner.run(suite);

  let deltas: DeltaReport | null = null;
  if (opts.baseline !== false) {
    const baselineStore = new FileBaselineStore(opts.baselineDir);
    deltas = await computeDeltas(run, suite, baselineStore, {
      defaultThreshold: loaded.config.thresholds.regression,
      judgeHash,
    });
    run.summary.regressions = deltas.regressions.length;
    await storage.saveRun(run);
  }

  await reporter.onRunEnd({ suite, run, deltas, loaded });

  if (opts.junitPath) {
    const absolute = resolve(opts.junitPath);
    const xml = renderJUnitXml({ run, suite, deltas });
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, xml);
    console.error(`drift-ci: wrote JUnit report to ${absolute}`);
  }

  if (deltas && deltas.regressions.length > 0) return 1;
  return 0;
}

function resolveProvider(
  config: DriftConfig,
  opts: RunOptions,
): ProviderAdapter {
  const name = opts.provider ?? config.provider.name;
  const model = opts.model ?? config.provider.model;
  return createProvider({
    name,
    model,
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
