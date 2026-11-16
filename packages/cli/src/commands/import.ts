import { InvalidArgumentError, type Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Document, isMap, isScalar, isSeq, parseDocument, stringify } from 'yaml';
import {
  loadConfigFromFile,
  parseSuite,
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
const DEFAULT_CONFIG = '.drift/config.yaml';
export const KNOWN_EVALUATORS = [
  'exact-match',
  'contains',
  'json-schema',
  'cosine-similarity',
  'llm-judge',
  'faithfulness',
  'tool-call',
  'refusal-detection',
  'rubric-checklist',
  'safety-classifier',
];
const YAML_OPTS = { lineWidth: 0, flowCollectionPadding: false } as const;

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
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < 1) {
    throw new InvalidArgumentError('must be a positive integer.');
  }
  return n;
}

function collect(v: string, prev: string[]): string[] {
  return [...prev, v];
}
/* c8 ignore stop */

/** Returns the suite path, or a string error message wrapped as { error }. */
function resolveSuitePath(opts: ImportOptions): string | { error: string } {
  if (opts.suite) return opts.suite;
  if (!existsSync(opts.config)) {
    if (opts.config === DEFAULT_CONFIG) return DEFAULT_SUITE;
    return { error: `Config not found: ${opts.config}` };
  }
  try {
    return loadConfigFromFile(opts.config).config.suite;
  } catch (e) {
    const issues = (e as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    const msg = issues?.length
      ? `${issues[0].path.join('.')}: ${issues[0].message}`
      : (e as Error).message;
    return { error: `Can't read config ${opts.config}: ${msg.split(String.fromCharCode(10))[0]}` };
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, content);
    for (let attempt = 1; ; attempt++) {
      try {
        renameSync(tmp, path);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (attempt >= 3 || (code !== 'EPERM' && code !== 'EBUSY')) throw e;
        sleepSync(50);
      }
    }
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // report the original write/rename error, not the cleanup failure
    }
    throw e;
  }
}

function isBlankDocument(doc: Document): boolean {
  return doc.contents === null || (isScalar(doc.contents) && doc.contents.value == null);
}

function joinComments(...parts: (string | null | undefined)[]): string | undefined {
  const present = parts.filter((p): p is string => !!p);
  return present.length > 0 ? present.join('\n') : undefined;
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

  const unknown = (opts.evaluator ?? []).find((n) => !KNOWN_EVALUATORS.includes(n));
  if (unknown !== undefined) {
    io.err(`Unknown evaluator "${unknown}". Known: ${KNOWN_EVALUATORS.join(', ')}`);
    return 2;
  }

  const resolved = resolveSuitePath(opts);
  if (typeof resolved !== 'string') {
    io.err(resolved.error);
    return 2;
  }
  const suitePath = resolved;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    io.err(`drift-ci import: ${(e as Error).message}`);
    return 2;
  }

  let doc: Document | undefined;
  let leadingComment: string | undefined;
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
    if (isBlankDocument(doc)) {
      leadingComment = joinComments(
        doc.commentBefore,
        isScalar(doc.contents) ? doc.contents.commentBefore : undefined,
      );
      doc = undefined; // empty, comments-only, `---` or `null`
    }
  }
  if (!doc) {
    doc = new Document({
      version: 1,
      id: 'imported',
      name: 'Imported production traces',
      evaluators: ['llm-judge'],
      cases: [],
    });
    if (leadingComment) doc.commentBefore = leadingComment;
  }

  const cases = doc.get('cases', true);
  if (!isSeq(cases)) {
    io.err(`${suitePath} has no \`cases\` list.`);
    return 2;
  }
  cases.flow = false;
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
    added.push(withEvaluators(r.case, opts.evaluator));
    redactions += r.redactions;
  }

  const warnEvaluators =
    added.length > 0 &&
    !opts.evaluator?.length &&
    !evaluatorNames(doc.toJS().evaluators).some((n) => REFERENCE_EVALUATORS.has(n));

  if (added.length === 0) {
    report(io, { suitePath, added: 0, present, skips, redactions, dryRun: !!opts.dryRun });
    // Re-importing the same file is a no-op, not a failure.
    return present > 0 ? 0 : 1;
  }

  for (const tc of added) cases.add(doc.createNode(tc));
  const output = doc.toString(YAML_OPTS);
  try {
    parseSuite(output);
  } catch (e) {
    const issues = (e as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    io.err(`The updated suite is invalid, nothing written:`);
    if (!issues) io.err(`  ${(e as Error).message.split(String.fromCharCode(10))[0]}`);
    else {
      const parsed = doc.toJS() as { cases?: { id?: unknown }[] };
      for (const issue of issues) {
        let label = issue.path.join('.');
        if (issue.path[0] === 'cases' && typeof issue.path[1] === 'number') {
          const id = parsed.cases?.[issue.path[1]]?.id;
          if (typeof id === 'string') label = [id, ...issue.path.slice(2)].join('.');
        }
        io.err(`  ${label}: ${issue.message}`);
      }
    }
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
    io.out(stringify(added, { lineWidth: 0 }).trimEnd());
    return 0;
  }

  try {
    writeAtomically(suitePath, output);
  } catch (e) {
    io.err(`Can't write ${suitePath}: ${(e as Error).message} (nothing written)`);
    return 2;
  }

  report(io, { suitePath, added: added.length, present, skips, redactions, dryRun: false });
  io.out('');
  io.out(
    `Next: run \`drift-ci run\`, then \`drift-ci baseline accept ${suitePath} --all\` to record ` +
      "today's scores, and commit the suite and .drift/baseline/.",
  );
  return 0;
}

function withEvaluators(c: TestCase, evaluators: string[] | undefined): TestCase {
  if (!evaluators?.length) return c;
  const { tags, ...rest } = c;
  return { ...rest, evaluators: [...evaluators], ...(tags ? { tags } : {}) } as TestCase;
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
