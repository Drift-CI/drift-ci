import type { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Document, isMap, isSeq, parse as yamlParse, parseDocument, stringify } from 'yaml';
import {
  loadConfigFromFile,
  SuiteSchema,
  traceToCase,
  type TestCase,
  type TraceSkipReason,
} from '@drift-ci/core';

export interface ImportOptions {
  /** Suite file to add cases to. Defaults to the config's `suite`, else .drift/suite.yaml. */
  suite?: string;
  config: string;
  prefix: string;
  limit?: number;
  evaluator?: string[];
  dryRun?: boolean;
}

export interface ImportIO {
  out: (line: string) => void;
  err: (line: string) => void;
}

const consoleIO: ImportIO = { out: (l) => console.log(l), err: (l) => console.error(l) };

const PREFIX_RE = /^[a-z0-9\-_]+$/;
/** Evaluators that compare free text with `expected` usefully. */
const REFERENCE_EVALUATORS = new Set(['llm-judge', 'cosine-similarity']);
const MAX_SKIP_LINES = 20;
const DEFAULT_SUITE = '.drift/suite.yaml';

/* c8 ignore start -- Commander wiring; executeImport is tested directly. */
export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Add production chat traces (JSONL) to a suite as test cases')
    .argument('<file>', 'JSONL file, one chat trace per line')
    .option('--suite <path>', "suite file to add cases to (default: the config's suite)")
    .option('--config <path>', 'drift-ci config path', '.drift/config.yaml')
    .option('--prefix <prefix>', 'prefix for generated case IDs', 'prod')
    .option('--limit <n>', 'import at most N new cases', parsePositiveInt)
    .option('--evaluator <name>', 'evaluator for the imported cases (repeatable)', collect, [])
    .option('--dry-run', 'print the YAML that would be added and write nothing', false)
    .action((file: string, opts: ImportOptions) => {
      const code = executeImport(file, opts);
      if (code !== 0) process.exit(code);
    });
}

function parsePositiveInt(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--limit must be a positive integer (got "${v}")`);
  return n;
}

function collect(v: string, prev: string[]): string[] {
  return [...prev, v];
}
/* c8 ignore stop */

function resolveSuitePath(opts: ImportOptions): string {
  if (opts.suite) return opts.suite;
  if (existsSync(opts.config)) return loadConfigFromFile(opts.config).config.suite;
  return DEFAULT_SUITE;
}

function evaluatorNames(specs: unknown): string[] {
  if (!Array.isArray(specs)) return ['exact-match']; // the runner's default
  return specs.map((s) => (typeof s === 'string' ? s : String((s as { name?: unknown }).name)));
}

/** Returns the process exit code: 0 ok, 1 nothing imported / invalid result, 2 unreadable input. */
export function executeImport(file: string, opts: ImportOptions, io: ImportIO = consoleIO): number {
  if (!PREFIX_RE.test(opts.prefix)) {
    io.err(`--prefix must contain only lowercase letters, digits, - and _ (got "${opts.prefix}").`);
    return 2;
  }

  let suitePath: string;
  let text: string;
  try {
    suitePath = resolveSuitePath(opts);
    text = readFileSync(file, 'utf8');
  } catch (e) {
    io.err(`drift-ci import: ${(e as Error).message}`);
    return 2;
  }

  let doc: Document;
  if (existsSync(suitePath)) {
    try {
      doc = parseDocument(readFileSync(suitePath, 'utf8'));
    } catch (e) {
      io.err(`Can't read ${suitePath}: ${(e as Error).message}`);
      return 2;
    }
    if (doc.errors.length > 0) {
      io.err(`Can't parse ${suitePath}: ${doc.errors[0].message}`);
      return 2;
    }
  } else {
    doc = new Document({
      version: 1,
      id: 'imported',
      name: 'Imported production traces',
      evaluators: ['llm-judge'],
      cases: [],
    });
  }

  const cases = doc.get('cases', true);
  if (!isSeq(cases)) {
    io.err(`${suitePath} has no \`cases\` list.`);
    return 2;
  }
  const seen = new Set<string>();
  for (const item of cases.items) {
    const id = isMap(item) ? item.get('id') : undefined;
    if (typeof id === 'string') seen.add(id);
  }

  const added: TestCase[] = [];
  const skips: { line: number; reason: TraceSkipReason }[] = [];
  let present = 0;
  let redactions = 0;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (opts.limit !== undefined && added.length >= opts.limit) break;
    const line = lines[i].trim();
    if (!line) continue;
    let trace: unknown;
    try {
      trace = JSON.parse(line);
    } catch {
      skips.push({ line: i + 1, reason: 'invalid-json' });
      continue;
    }
    const r = traceToCase(trace, { prefix: opts.prefix });
    if (!r.ok) {
      skips.push({ line: i + 1, reason: r.reason });
      continue;
    }
    if (seen.has(r.case.id)) {
      present += 1;
      continue;
    }
    seen.add(r.case.id);
    added.push(opts.evaluator?.length ? { ...r.case, evaluators: [...opts.evaluator] } : r.case);
    redactions += r.redactions;
  }

  const warnEvaluators =
    added.length > 0 &&
    !opts.evaluator?.length &&
    !evaluatorNames(doc.toJS().evaluators).some((n) => REFERENCE_EVALUATORS.has(n));

  if (added.length === 0) {
    report(io, { suitePath, added: 0, present, skips, redactions, dryRun: !!opts.dryRun });
    return present > 0 && skips.length === 0 ? 0 : 1;
  }

  for (const tc of added) cases.add(doc.createNode(tc));
  const output = doc.toString();
  const check = SuiteSchema.safeParse(yamlParse(output));
  if (!check.success) {
    io.err(`The updated suite is invalid, nothing written:`);
    for (const issue of check.error.issues) io.err(`  ${issue.path.join('.')}: ${issue.message}`);
    return 1;
  }

  if (warnEvaluators) {
    io.err(
      "Warning: the suite's evaluators won't compare imported cases with the production reply " +
        'in a useful way. Pass --evaluator llm-judge (or cosine-similarity) to set one per case.',
    );
  }

  if (opts.dryRun) {
    report(io, { suitePath, added: added.length, present, skips, redactions, dryRun: true });
    io.out('');
    io.out(stringify(added).trimEnd());
    return 0;
  }

  mkdirSync(dirname(suitePath), { recursive: true });
  const tmp = `${suitePath}.tmp`;
  writeFileSync(tmp, output);
  renameSync(tmp, suitePath);

  report(io, { suitePath, added: added.length, present, skips, redactions, dryRun: false });
  io.out('');
  io.out(
    'Next: run `drift-ci baseline accept` to record today\'s scores, then commit the suite and .drift/baseline/.',
  );
  return 0;
}

function report(
  io: ImportIO,
  r: {
    suitePath: string;
    added: number;
    present: number;
    skips: { line: number; reason: TraceSkipReason }[];
    redactions: number;
    dryRun: boolean;
  },
): void {
  const verb = r.dryRun ? 'Would import' : 'Imported';
  const presentNote = r.present > 0 ? ` (${r.present} already present)` : '';
  io.out(`${verb} ${r.added} case(s) into ${r.suitePath}${presentNote}.`);
  if (r.skips.length > 0) {
    io.out(`Skipped ${r.skips.length} line(s):`);
    for (const s of r.skips.slice(0, MAX_SKIP_LINES)) io.out(`  line ${s.line}: ${s.reason}`);
    if (r.skips.length > MAX_SKIP_LINES) io.out(`  … and ${r.skips.length - MAX_SKIP_LINES} more`);
  }
  if (r.redactions > 0) io.out(`Redacted ${r.redactions} secret(s) from imported text.`);
}
