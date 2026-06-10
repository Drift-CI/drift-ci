import type { CaseResult } from '@drift-ci/core';

import type {
  Reporter,
  RunEndContext,
  RunStartContext,
} from './interface.js';

export interface TextReporterOptions {
  out?: NodeJS.WritableStream;
}

export class TextReporter implements Reporter {
  private readonly out: NodeJS.WritableStream;

  constructor(opts: TextReporterOptions = {}) {
    this.out = opts.out ?? process.stdout;
  }

  onRunStart(_ctx: RunStartContext): void {}

  onCaseComplete(_result: CaseResult): void {}

  onRunEnd(ctx: RunEndContext): void {
    renderSummary(ctx, (line) => this.out.write(line + '\n'));
  }
}

export function renderSummary(
  { suite, run, deltas, loaded }: RunEndContext,
  emit: (line: string) => void,
): void {
  emit('');
  emit(`Suite:    ${suite.name} (${suite.id})`);
  emit(`Provider: ${run.provider}`);
  emit(`Run:      ${run.id}`);
  emit(
    `Cases:    ${run.summary.passed}/${run.summary.total} passed, ` +
      `${run.summary.transient} transient, ` +
      `${run.summary.evaluatorErrors} evaluator errors, ` +
      `${run.summary.failed} config errors, ` +
      `${run.summary.regressions} regressions`,
  );
  emit(`Avg score:   ${run.summary.avgScore.toFixed(3)}`);
  emit(`Avg latency: ${run.summary.avgLatencyMs.toFixed(1)} ms`);
  if (loaded.upgradedInMemory) {
    emit(`Config:      auto-upgraded in memory (persist by bumping version)`);
  }

  const regressionSet = new Set(deltas?.regressions ?? []);
  const improvementSet = new Set(deltas?.improvements ?? []);
  const missingSet = new Set(deltas?.missingBaselines ?? []);
  const staleSuiteSet = new Set(deltas?.staleBaselines ?? []);
  const staleJudgeSet = new Set(deltas?.staleJudges ?? []);
  const noScoreSet = new Set(deltas?.noScore ?? []);

  emit('');
  emit('Per case:');
  for (const c of run.cases) {
    emit(formatCaseLine(c, deltas, {
      regressionSet,
      improvementSet,
      missingSet,
      staleSuiteSet,
      staleJudgeSet,
      noScoreSet,
    }));
  }

  if (deltas) {
    if (deltas.missingBaselines.length > 0) {
      emit('');
      emit(
        `\u2139 ${deltas.missingBaselines.length} case(s) have no baseline yet. ` +
          `Run: drift-ci baseline init`,
      );
    }
    if (deltas.staleBaselines.length > 0) {
      emit('');
      emit(
        `\u26A0 ${deltas.staleBaselines.length} baseline(s) are stale (suite definition changed). ` +
          `Run: drift-ci baseline accept --cases <id>`,
      );
    }
    if (deltas.staleJudges.length > 0) {
      emit('');
      emit(
        `\u26A0 ${deltas.staleJudges.length} baseline(s) used a different judge. ` +
          `Scores are not directly comparable.`,
      );
    }
    if (deltas.regressions.length > 0) {
      emit('');
      emit(
        `\u2717 ${deltas.regressions.length} regression(s) detected. ` +
          `Review the diff, then: drift-ci baseline accept --cases <id> if intentional.`,
      );
    }
  }
}

interface FlagSets {
  regressionSet: Set<string>;
  improvementSet: Set<string>;
  missingSet: Set<string>;
  staleSuiteSet: Set<string>;
  staleJudgeSet: Set<string>;
  noScoreSet: Set<string>;
}

function formatCaseLine(
  c: CaseResult,
  deltas: RunEndContext['deltas'],
  sets: FlagSets,
): string {
  let marker = c.status === 'pass' ? '\u2713' : '\u2717';
  const flags: string[] = [];
  if (sets.regressionSet.has(c.caseId)) {
    marker = '\u2717';
    flags.push('REGRESSION');
  } else if (sets.improvementSet.has(c.caseId)) {
    flags.push('improved');
  }
  if (sets.missingSet.has(c.caseId)) flags.push('no baseline');
  if (sets.staleSuiteSet.has(c.caseId)) flags.push('stale-suite');
  if (sets.staleJudgeSet.has(c.caseId)) flags.push('stale-judge');
  if (sets.noScoreSet.has(c.caseId)) flags.push('no-score');

  const scoreText = Number.isNaN(c.score) ? '\u2014' : c.score.toFixed(3);
  const delta = deltas?.deltas[c.caseId];
  const deltaText =
    delta === undefined || delta === 0
      ? ''
      : ` \u0394${delta > 0 ? '+' : ''}${delta.toFixed(3)}`;
  const flagText = flags.length > 0 ? `  [${flags.join(', ')}]` : '';
  return `  ${marker} ${c.caseId.padEnd(24)} ${c.status.padEnd(20)} score=${scoreText}${deltaText}${flagText}`;
}

