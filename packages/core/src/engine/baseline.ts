import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

import type {
  CaseResult,
  RunResult,
  Suite,
  TestCase,
} from '../types/index.js';
import { redactSecrets, type RedactionCount } from './redaction.js';

export const OUTPUT_MAX_BYTES = 8 * 1024;
const BASELINE_SCHEMA_URL = 'https://drift-ci.dev/schema/baseline-v1.json';

export interface CapturedBy {
  commit?: string;
  runId: string;
  provider: string;
}

export interface BaselineEntry {
  caseId: string;
  suiteId: string;
  capturedAt: string;
  capturedBy: CapturedBy;
  suiteHash: string;
  judgeHash?: string;
  redactions?: RedactionCount[];
  score: number;
  output: string;
  outputTruncated: boolean;
  outputFullHash: string;
  evaluatorBreakdown?: Record<string, number>;
}

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value ?? null);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ':' +
          stableStringify((value as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

export function computeSuiteHash(tc: TestCase): string {
  const canonical = stableStringify({
    input: tc.input ?? null,
    expected: tc.expected ?? null,
    criteria: tc.criteria ?? null,
    evaluators: tc.evaluators ?? null,
    threshold: tc.threshold ?? null,
    messages: tc.messages ?? null,
    schema: tc.schema ?? null,
    systemPrompt: tc.systemPrompt ?? null,
    // Rubric edits / reorders / mode swaps / quorum changes invalidate
    // baselines via the same stale-baseline path (arch §10, M30).
    rubric: tc.rubric ?? null,
    rubricQuorum: tc.rubricQuorum ?? null,
  });
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex');
}

export function computeJudgeHash(
  providerName: string,
  model: string,
  promptTemplate: string,
): string {
  const canonical = `${providerName}:${model}:${promptTemplate}`;
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex');
}

/**
 * Quorum-aware judge hash for the `rubric-checklist` evaluator.
 *
 *   sha256("rubric:" + sortedJudgeKeys.join(",") + ":" + threshold)
 *
 * Per arch §10 (M30): a swap of any judge in the quorum or a change
 * of `threshold` from `majority` to `unanimous` invalidates baselines
 * via the existing `stale-judge` warning path (no regression).
 *
 * Note the keys are sorted before hashing — the spec is intentional
 * about *set* identity rather than *order* identity, since the
 * caller can iterate judges in any order without changing semantics
 * (`Promise.all` over the array returns ordered results regardless).
 */
export function computeRubricJudgeHash(
  judgeKeys: string[],
  threshold: 'majority' | 'unanimous',
): string {
  const canonical = `rubric:${[...judgeKeys].sort().join(',')}:${threshold}`;
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex');
}

export function serialiseBaseline(entry: BaselineEntry): string {
  const sortedBreakdown =
    entry.evaluatorBreakdown
      ? Object.fromEntries(
          Object.entries(entry.evaluatorBreakdown).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : undefined;

  const ordered: Record<string, unknown> = {
    $schema: BASELINE_SCHEMA_URL,
    caseId: entry.caseId,
    suiteId: entry.suiteId,
    suiteHash: entry.suiteHash,
    judgeHash: entry.judgeHash,
    score: entry.score,
    output: entry.output,
    outputTruncated: entry.outputTruncated,
    outputFullHash: entry.outputFullHash,
    evaluatorBreakdown: sortedBreakdown,
    redactions: entry.redactions && entry.redactions.length > 0
      ? entry.redactions
      : undefined,
    capturedAt: entry.capturedAt,
    capturedBy: entry.capturedBy,
  };

  const pruned = Object.fromEntries(
    Object.entries(ordered).filter(([, v]) => v !== undefined),
  );
  return JSON.stringify(pruned, null, 2);
}

export function baselineContentEqual(
  a: BaselineEntry,
  b: BaselineEntry,
): boolean {
  return (
    a.score === b.score &&
    a.output === b.output &&
    a.outputFullHash === b.outputFullHash &&
    a.outputTruncated === b.outputTruncated &&
    a.suiteHash === b.suiteHash &&
    (a.judgeHash ?? null) === (b.judgeHash ?? null) &&
    stableStringify(a.evaluatorBreakdown ?? {}) ===
      stableStringify(b.evaluatorBreakdown ?? {})
  );
}

export interface FromCaseResultOptions {
  commit?: string;
  judgeHash?: string;
}

export class FileBaselineStore {
  constructor(private root = '.drift/baseline') {}

  pathFor(caseId: string): string {
    return join(this.root, `${caseId}.json`);
  }

  async load(caseId: string): Promise<BaselineEntry | null> {
    const p = this.pathFor(caseId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as BaselineEntry;
  }

  async save(entry: BaselineEntry): Promise<BaselineEntry> {
    const redacted = applyRedaction(entry);
    const p = this.pathFor(redacted.caseId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, serialiseBaseline(redacted) + '\n');
    return redacted;
  }

  async saveMerged(entry: BaselineEntry): Promise<'written' | 'unchanged'> {
    const redacted = applyRedaction(entry);
    const existing = await this.load(redacted.caseId);
    if (existing && baselineContentEqual(existing, redacted)) {
      return 'unchanged';
    }
    const p = this.pathFor(redacted.caseId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, serialiseBaseline(redacted) + '\n');
    return 'written';
  }

  async loadAll(suiteId: string): Promise<Record<string, BaselineEntry>> {
    if (!existsSync(this.root)) return {};

    const out: Record<string, BaselineEntry> = {};
    for (const file of walkJsonFiles(this.root)) {
      const entry = JSON.parse(readFileSync(file, 'utf8')) as BaselineEntry;
      if (entry.suiteId === suiteId) out[entry.caseId] = entry;
    }
    return out;
  }

  async listBaselineFiles(): Promise<string[]> {
    if (!existsSync(this.root)) return [];
    return Array.from(walkJsonFiles(this.root), (abs) =>
      relative(this.root, abs).split(sep).join('/'),
    );
  }

  async deleteCase(caseId: string): Promise<boolean> {
    const p = this.pathFor(caseId);
    if (!existsSync(p)) return false;
    const fs = await import('node:fs/promises');
    await fs.rm(p);
    return true;
  }

  static fromCaseResult(
    tc: TestCase,
    result: CaseResult,
    run: RunResult,
    options: FromCaseResultOptions = {},
  ): BaselineEntry {
    const fullOutput = result.output ?? '';
    const truncated = Buffer.byteLength(fullOutput, 'utf8') > OUTPUT_MAX_BYTES;
    const output = truncated
      ? truncateUtf8(fullOutput, OUTPUT_MAX_BYTES)
      : fullOutput;

    return {
      caseId: tc.id,
      suiteId: run.suiteId,
      capturedAt: new Date().toISOString(),
      capturedBy: {
        commit: options.commit,
        runId: run.id,
        provider: run.provider,
      },
      suiteHash: computeSuiteHash(tc),
      judgeHash: options.judgeHash,
      score: result.score,
      output,
      outputTruncated: truncated,
      outputFullHash:
        'sha256:' + createHash('sha256').update(fullOutput).digest('hex'),
      evaluatorBreakdown: extractScoreBreakdown(result.evaluatorBreakdown),
    };
  }
}

function applyRedaction(entry: BaselineEntry): BaselineEntry {
  const scan = redactSecrets(entry.output);
  if (scan.redactions.length === 0) {
    return entry;
  }
  const redactedFull = redactSecrets(rehydrateFullOutput(entry)).text;
  const truncated =
    Buffer.byteLength(redactedFull, 'utf8') > OUTPUT_MAX_BYTES;
  const storedOutput = truncated
    ? truncateUtf8(redactedFull, OUTPUT_MAX_BYTES)
    : redactedFull;
  return {
    ...entry,
    output: storedOutput,
    outputTruncated: truncated,
    outputFullHash:
      'sha256:' + createHash('sha256').update(redactedFull).digest('hex'),
    redactions: scan.redactions,
  };
}

function rehydrateFullOutput(entry: BaselineEntry): string {
  if (!entry.outputTruncated) return entry.output;
  return entry.output;
}

function truncateUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.byteLength <= maxBytes) return s;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
  return buf.slice(0, end).toString('utf8');
}

function extractScoreBreakdown(
  input: Record<string, unknown> | undefined,
): Record<string, number> | undefined {
  if (!input) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'number') {
      out[k] = v;
    } else if (
      v !== null &&
      typeof v === 'object' &&
      typeof (v as { score?: unknown }).score === 'number'
    ) {
      out[k] = (v as { score: number }).score;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function* walkJsonFiles(root: string): Generator<string> {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) stack.push(full);
      else if (stat.isFile() && name.endsWith('.json')) yield full;
    }
  }
}

export interface DeltaReport {
  deltas: Record<string, number>;
  regressions: string[];
  improvements: string[];
  missingBaselines: string[];
  staleBaselines: string[];
  staleJudges: string[];
  noScore: string[];
}

export interface ComputeDeltasOptions {
  judgeHash?: string;
  defaultThreshold?: number;
}

export async function computeDeltas(
  run: RunResult,
  suite: Suite,
  store: FileBaselineStore,
  options: ComputeDeltasOptions = {},
): Promise<DeltaReport> {
  const baselines = await store.loadAll(run.suiteId);
  const defaultThreshold =
    options.defaultThreshold ?? suite.default_threshold ?? 0.1;

  const report: DeltaReport = {
    deltas: {},
    regressions: [],
    improvements: [],
    missingBaselines: [],
    staleBaselines: [],
    staleJudges: [],
    noScore: [],
  };

  for (const caseResult of run.cases) {
    const caseId = caseResult.caseId;
    const tc = suite.cases.find((c) => c.id === caseId);
    const baseline = baselines[caseId];

    if (Number.isNaN(caseResult.score)) {
      report.noScore.push(caseId);
      report.deltas[caseId] = 0;
      continue;
    }

    if (!baseline) {
      report.missingBaselines.push(caseId);
      report.deltas[caseId] = 0;
      continue;
    }

    if (tc && computeSuiteHash(tc) !== baseline.suiteHash) {
      report.staleBaselines.push(caseId);
    }
    if (
      options.judgeHash !== undefined &&
      baseline.judgeHash !== undefined &&
      options.judgeHash !== baseline.judgeHash
    ) {
      report.staleJudges.push(caseId);
    }

    const delta = caseResult.score - baseline.score;
    report.deltas[caseId] = delta;

    const threshold = caseResult.threshold ?? defaultThreshold;
    if (report.staleBaselines.includes(caseId)) continue;

    if (-delta > threshold) {
      report.regressions.push(caseId);
    } else if (delta > threshold) {
      report.improvements.push(caseId);
    }
  }

  return report;
}
