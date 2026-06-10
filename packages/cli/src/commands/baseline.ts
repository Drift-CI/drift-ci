import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import {
  createProvider,
  FileBaselineStore,
  hasLLMJudge,
  JsonFileStorage,
  judgeHashForProvider,
  loadConfigFromFile,
  loadSuiteFromFile,
  type BaselineEntry,
  type CaseResult,
  type DriftConfig,
  type ProviderAdapter,
  type RunResult,
  type Suite,
  type TestCase,
} from '@drift-ci/core';

export interface CommonOptions {
  baselineDir: string;
  runsDir: string;
  config: string;
}

export interface AcceptOptions extends CommonOptions {
  cases?: string;
  all?: boolean;
  dryRun?: boolean;
  commit?: string;
}

export interface InitOptions extends CommonOptions {
  commit?: string;
  force?: boolean;
}

export type DoctorOptions = CommonOptions;

export interface PruneOptions extends CommonOptions {
  dryRun?: boolean;
}

/* c8 ignore start -- Commander wiring; covered by the CLI E2E in a subprocess. */
export function registerBaselineCommand(program: Command): void {
  const cmd = program
    .command('baseline')
    .description('Manage drift-ci baselines');

  cmd
    .command('init')
    .description('Write baselines from the most recent run for cases that have none')
    .argument('<suite>', 'path to suite.yaml')
    .option('--config <path>', 'drift-ci config path', '.drift/config.yaml')
    .option('--baseline-dir <path>', 'baseline directory', '.drift/baseline')
    .option('--runs-dir <path>', 'runs directory', '.drift/runs')
    .option('--commit <sha>', 'commit SHA to record in capturedBy')
    .option('--force', 'overwrite existing baselines', false)
    .action(async (suitePath: string, opts: InitOptions) => {
      await executeInit(suitePath, opts);
    });

  cmd
    .command('accept')
    .description('Accept changes from the most recent run as the new baseline')
    .argument('<suite>', 'path to suite.yaml')
    .option('--cases <ids>', 'comma-separated case IDs to accept')
    .option('--all', 'accept all cases from the most recent run', false)
    .option('--dry-run', 'show what would change without writing', false)
    .option('--config <path>', 'drift-ci config path', '.drift/config.yaml')
    .option('--baseline-dir <path>', 'baseline directory', '.drift/baseline')
    .option('--runs-dir <path>', 'runs directory', '.drift/runs')
    .option('--commit <sha>', 'commit SHA to record in capturedBy')
    .action(async (suitePath: string, opts: AcceptOptions) => {
      await executeAccept(suitePath, opts);
    });

  cmd
    .command('doctor')
    .description('Report missing and stale baselines against a suite')
    .argument('<suite>', 'path to suite.yaml')
    .option('--config <path>', 'drift-ci config path', '.drift/config.yaml')
    .option('--baseline-dir <path>', 'baseline directory', '.drift/baseline')
    .option('--runs-dir <path>', 'runs directory', '.drift/runs')
    .action(async (suitePath: string, opts: DoctorOptions) => {
      await executeDoctor(suitePath, opts);
    });

  cmd
    .command('prune')
    .description('Delete baseline files for case IDs not present in the suite')
    .argument('<suite>', 'path to suite.yaml')
    .option('--dry-run', 'show what would be deleted', false)
    .option('--config <path>', 'drift-ci config path', '.drift/config.yaml')
    .option('--baseline-dir <path>', 'baseline directory', '.drift/baseline')
    .option('--runs-dir <path>', 'runs directory', '.drift/runs')
    .action(async (suitePath: string, opts: PruneOptions) => {
      await executePrune(suitePath, opts);
    });
}
/* c8 ignore stop */

export async function executeInit(
  suitePath: string,
  opts: InitOptions,
): Promise<void> {
  const suite = loadSuiteFromFile(suitePath);
  const { run, store } = await loadSuiteContext(suite, opts);
  const existing = await store.loadAll(suite.id);
  const judgeHash = resolveJudgeHash(suite, opts);

  const caseById = indexCases(suite.cases);
  let written = 0;
  let skipped = 0;

  for (const cr of run.cases) {
    if (!caseById[cr.caseId]) continue;
    if (!isScoreable(cr)) continue;
    if (existing[cr.caseId] && !opts.force) {
      skipped += 1;
      continue;
    }
    const entry = FileBaselineStore.fromCaseResult(
      caseById[cr.caseId],
      cr,
      run,
      { commit: opts.commit, judgeHash },
    );
    await store.save(entry);
    written += 1;
  }

  console.log(`Baseline init: ${written} written, ${skipped} skipped.`);
  if (skipped > 0 && !opts.force) {
    console.log('Use --force to overwrite existing baselines.');
  }
}

export async function executeAccept(
  suitePath: string,
  opts: AcceptOptions,
): Promise<void> {
  if (opts.all !== true && !opts.cases) {
    throw new Error('Pass --all or --cases <ids> to select which cases to accept.');
  }
  const suite = loadSuiteFromFile(suitePath);
  const { run, store } = await loadSuiteContext(suite, opts);
  const caseById = indexCases(suite.cases);
  const judgeHash = resolveJudgeHash(suite, opts);

  const selected = new Set(
    opts.all
      ? run.cases.map((c) => c.caseId)
      : (opts.cases ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  if (selected.size === 0) {
    throw new Error('No cases selected.');
  }

  const results: {
    caseId: string;
    outcome: 'written' | 'unchanged' | 'skipped-unscored' | 'skipped-not-in-suite';
  }[] = [];

  for (const cr of run.cases) {
    if (!selected.has(cr.caseId)) continue;
    if (!caseById[cr.caseId]) {
      results.push({ caseId: cr.caseId, outcome: 'skipped-not-in-suite' });
      continue;
    }
    if (!isScoreable(cr)) {
      results.push({ caseId: cr.caseId, outcome: 'skipped-unscored' });
      continue;
    }
    const entry = FileBaselineStore.fromCaseResult(
      caseById[cr.caseId],
      cr,
      run,
      { commit: opts.commit, judgeHash },
    );
    if (opts.dryRun) {
      const existing = await store.load(entry.caseId);
      const outcome: 'written' | 'unchanged' =
        existing && baselineMatches(existing, entry) ? 'unchanged' : 'written';
      results.push({ caseId: cr.caseId, outcome });
    } else {
      const outcome = await store.saveMerged(entry);
      results.push({ caseId: cr.caseId, outcome });
    }
  }

  const unmatched = [...selected].filter(
    (id) => !results.some((r) => r.caseId === id),
  );

  const written = results.filter((r) => r.outcome === 'written').length;
  const unchanged = results.filter((r) => r.outcome === 'unchanged').length;
  const skipped = results.filter((r) => r.outcome.startsWith('skipped')).length;

  console.log(
    `Baseline accept${opts.dryRun ? ' (dry run)' : ''}: ${written} written, ${unchanged} unchanged, ${skipped} skipped.`,
  );
  for (const r of results) {
    console.log(`  ${r.outcome.padEnd(24)} ${r.caseId}`);
  }
  for (const id of unmatched) {
    console.log(`  not-in-run               ${id}`);
  }
}

export async function executeDoctor(
  suitePath: string,
  opts: DoctorOptions,
): Promise<void> {
  const suite = loadSuiteFromFile(suitePath);
  const store = new FileBaselineStore(opts.baselineDir);
  const baselines = await store.loadAll(suite.id);

  const caseIds = new Set(suite.cases.map((c) => c.id));
  const baselineIds = new Set(Object.keys(baselines));
  const missing = suite.cases.filter((c) => !baselineIds.has(c.id)).map((c) => c.id);
  const orphans = [...baselineIds].filter((id) => !caseIds.has(id));
  const { computeSuiteHash } = await import('@drift-ci/core');
  const stale = suite.cases
    .filter((c) => baselines[c.id] && computeSuiteHash(c) !== baselines[c.id].suiteHash)
    .map((c) => c.id);

  console.log(`Suite: ${suite.name} (${suite.id})`);
  console.log(`Cases in suite:      ${suite.cases.length}`);
  console.log(`Baselines on disk:   ${baselineIds.size}`);
  console.log(`Missing baselines:   ${missing.length}`);
  for (const id of missing) console.log(`  - ${id}`);
  console.log(`Orphan baselines:    ${orphans.length}`);
  for (const id of orphans) console.log(`  - ${id}`);
  console.log(`Stale baselines:     ${stale.length}`);
  for (const id of stale) console.log(`  - ${id}`);
}

export async function executePrune(
  suitePath: string,
  opts: PruneOptions,
): Promise<void> {
  const suite = loadSuiteFromFile(suitePath);
  const store = new FileBaselineStore(opts.baselineDir);
  const baselines = await store.loadAll(suite.id);
  const caseIds = new Set(suite.cases.map((c) => c.id));

  const orphans = Object.keys(baselines).filter((id) => !caseIds.has(id));

  console.log(
    `Baseline prune${opts.dryRun ? ' (dry run)' : ''}: ${orphans.length} orphan(s).`,
  );
  for (const id of orphans) {
    if (opts.dryRun) {
      console.log(`  would delete  ${id}`);
    } else {
      await store.deleteCase(id);
      console.log(`  deleted       ${id}`);
    }
  }
}

function resolveJudgeHash(
  suite: Suite,
  opts: CommonOptions,
): string | undefined {
  if (!hasLLMJudge(suite.evaluators)) return undefined;

  let config: DriftConfig;
  try {
    config = loadConfigFromFile(opts.config).config;
  } catch {
    return undefined;
  }

  const judge = config.judge;
  const provider = resolveProviderFor(config, judge);
  return judgeHashForProvider({ provider });
}

function resolveProviderFor(
  config: DriftConfig,
  judge: DriftConfig['judge'],
): ProviderAdapter {
  const name = judge?.provider ?? config.provider.name;
  const model = judge?.model ?? config.provider.model;
  return createProvider({
    name,
    model,
    apiKey: judge?.apiKey,
    baseUrl: judge?.baseUrl ?? config.provider.baseUrl,
    region: config.provider.region,
  });
}

async function loadSuiteContext(
  suite: Suite,
  opts: CommonOptions,
): Promise<{ run: RunResult; store: FileBaselineStore }> {
  if (!existsSync(opts.runsDir)) {
    throw new Error(
      `No runs found at ${opts.runsDir}. Run 'drift-ci run <suite>' first.`,
    );
  }
  const storage = new JsonFileStorage(opts.runsDir);
  const run = await storage.getMostRecentRun(suite.id);
  if (!run) {
    throw new Error(
      `No recent run found for suite "${suite.id}". Run 'drift-ci run <suite>' first.`,
    );
  }
  return { run, store: new FileBaselineStore(opts.baselineDir) };
}

function indexCases(cases: TestCase[]): Record<string, TestCase> {
  return Object.fromEntries(cases.map((c) => [c.id, c]));
}

function isScoreable(cr: CaseResult): boolean {
  if (Number.isNaN(cr.score)) return false;
  if (cr.status !== 'pass') return false;
  return true;
}

function baselineMatches(a: BaselineEntry, b: BaselineEntry): boolean {
  return (
    a.score === b.score &&
    a.output === b.output &&
    a.outputFullHash === b.outputFullHash &&
    a.outputTruncated === b.outputTruncated &&
    a.suiteHash === b.suiteHash
  );
}
