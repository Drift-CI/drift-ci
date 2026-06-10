import type { Command } from 'commander';
import { randomUUID } from 'node:crypto';

import {
  buildComparison,
  createEvaluatorChain,
  createProvider,
  loadConfigFromFile,
  loadSuiteFromFile,
  Runner,
  renderComparisonJson,
  renderComparisonTable,
  type DriftConfig,
  type ProviderAdapter,
  type RunResult,
} from '@drift-ci/core';

export interface CompareOptions {
  config: string;
  suite?: string;
  providers: string;
  output: 'table' | 'json';
}

/* c8 ignore start -- Commander wiring; covered by the CLI E2E in a subprocess. */
export function registerCompareCommand(program: Command): void {
  program
    .command('compare')
    .description(
      'Run a suite against multiple providers and emit a side-by-side comparison',
    )
    .option('--config <path>', 'drift-ci config path', '.drift/config.yaml')
    .option('--suite <path>', 'suite yaml path (overrides config)')
    .requiredOption(
      '-p, --providers <list>',
      'comma-separated `name:model` pairs (e.g. `anthropic:claude-sonnet-4-5,openai:gpt-4o-mini`)',
    )
    .option(
      '-o, --output <kind>',
      'output format: `table` (human) or `json` (tooling)',
      'table',
    )
    .action(async (opts: CompareOptions) => {
      if (opts.output !== 'table' && opts.output !== 'json') {
        console.error(
          `drift-ci: unknown --output '${opts.output}'. Use 'table' or 'json'.`,
        );
        process.exit(1);
      }
      const exitCode = await executeCompare(opts);
      if (exitCode !== 0) process.exit(exitCode);
    });
}
/* c8 ignore stop */

export async function executeCompare(opts: CompareOptions): Promise<number> {
  const loaded = loadConfigFromFile(opts.config);
  if (loaded.notice) console.error(loaded.notice);

  const suitePath = opts.suite ?? loaded.config.suite;
  const suite = loadSuiteFromFile(suitePath);

  const specs = parseProviderList(opts.providers);
  if (specs.length < 2) {
    console.error(
      `drift-ci: --providers requires at least 2 entries (got ${specs.length}).`,
    );
    return 1;
  }

  const providers = specs.map((s) => buildProvider(loaded.config, s));

  console.error(
    `drift-ci: comparing ${providers.length} providers on ${suite.cases.length} cases of ${suite.name}…`,
  );

  // Each provider's run is independent — fan out in parallel. The runner
  // already enforces per-run concurrency for case dispatch; this just
  // overlaps the per-provider waits.
  const runs = await Promise.all(
    providers.map((p) => runProvider(p, suite, loaded.config)),
  );

  const report = buildComparison(runs, suite);

  if (opts.output === 'json') {
    process.stdout.write(`${renderComparisonJson(report)}\n`);
  } else {
    const tty = Boolean(process.stdout.isTTY);
    process.stdout.write(`${renderComparisonTable(report, { color: tty })}\n`);
  }

  return 0;
}

// ─── private ────────────────────────────────────────────────────────────

interface ProviderSpec {
  name: string;
  model: string;
}

export function parseProviderList(raw: string): ProviderSpec[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const colon = entry.indexOf(':');
      if (colon === -1) {
        throw new Error(
          `compare: bad --providers entry "${entry}" — expected \`name:model\` (e.g. \`anthropic:claude-sonnet-4-5\`).`,
        );
      }
      const name = entry.slice(0, colon).trim();
      const model = entry.slice(colon + 1).trim();
      if (!name || !model) {
        throw new Error(
          `compare: bad --providers entry "${entry}" — both \`name\` and \`model\` are required.`,
        );
      }
      return { name, model };
    });
}

function buildProvider(config: DriftConfig, spec: ProviderSpec): ProviderAdapter {
  return createProvider({
    name: spec.name,
    model: spec.model,
    baseUrl: config.provider.baseUrl,
    region: config.provider.region,
    mock: config.provider.mock,
  });
}

async function runProvider(
  provider: ProviderAdapter,
  suite: ReturnType<typeof loadSuiteFromFile>,
  config: DriftConfig,
): Promise<RunResult> {
  const specs = suite.evaluators ?? ['exact-match'];
  const evaluatorForCase = (tc: (typeof suite.cases)[number]) =>
    createEvaluatorChain(tc.evaluators ?? specs, {
      testProvider: provider,
      // No judge wiring on compare — keeping the surface minimal. Cases
      // that depend on llm-judge would need the operator to thread a
      // judge through; for v1 of compare, exact-match / cosine /
      // json-schema are the sweet spot.
      case: tc,
    });

  const runner = new Runner({
    provider,
    evaluator: evaluatorForCase,
    // In-memory storage: compare doesn't persist runs. Operators run
    // a regular `drift-ci run` if they want CI history.
    storage: {
      saveRun: async () => undefined,
      getRun: async () => null,
      getMostRecentRun: async () => null,
      listRuns: async () => [],
      close: async () => undefined,
    },
    concurrency: config.concurrency,
    timeoutMs: config.timeoutMs,
    defaultThreshold: config.thresholds.regression,
  });

  const run = await runner.run(suite);
  // Stamp a unique id so the comparison can refer to it; the runner's
  // default id might collide across parallel runs in some shells.
  run.id = randomUUID();
  return run;
}
