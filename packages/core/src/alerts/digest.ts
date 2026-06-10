import type { DeltaReport } from '../engine/baseline.js';
import type { RunResult } from '../types/result.js';
import type { AlertPayload } from '../types/alerts.js';

/**
 * Weekly digest: pure summariser over a window of runs. (arch §14)
 *
 * The per-run `AlertRouter` (M27) fires immediately when a regression
 * lands. Schedule-trigger rules need a different code path — they
 * fire on a cron, summarising what happened in the past N hours/days
 * across many runs. This module provides:
 *
 * 1. {@link buildDigestPayload} — pure builder that turns a list of
 *    runs + their deltas into a single `AlertPayload`. Same wire
 *    format as a regression-fire payload, so the existing senders
 *    (Slack/Teams/Webhook/PagerDuty/Email from M28-M29) render it
 *    without per-channel code changes.
 *
 * 2. {@link runWeeklyDigest} — top-level driver that takes already-
 *    queried runs + deltas, builds the digest, and dispatches via a
 *    sender registry. Operators wire this into a cron container
 *    (mirroring the M22 retention sidecar) — drift-ci itself does
 *    not own a scheduler.
 *
 * The digest payload uses the same `version: 1` envelope as
 * `AlertPayload` so receivers don't have to discriminate. The
 * `regressions` array carries the **top-N regressions across the
 * window** (not all of them — a noisy week could have hundreds);
 * `reason` carries the summary stats.
 */

export const DEFAULT_DIGEST_TOP_N = 10;

export interface DigestRun {
  run: RunResult;
  deltas: DeltaReport;
}

export interface BuildDigestOptions {
  ruleId: string;
  ruleName: string;
  windowStart: Date;
  windowEnd: Date;
  /** Cap on regressions surfaced. Default 10 — beyond that operators want the dashboard. */
  topN?: number;
  /** Optional URL builder (run-id → dashboard link) for the worst regression's link. */
  runUrlBuilder?: (run: RunResult) => string;
  /** Override "now" for the `firedAt` field. Defaults to `new Date()`. */
  now?: Date;
}

export interface DigestSummary {
  /** Runs in the window. */
  totalRuns: number;
  /** Runs that contained at least one regression. */
  regressingRuns: number;
  /** Distinct suites covered in the window. */
  suites: string[];
  /** Distinct providers covered in the window. */
  providers: string[];
  /** Mean of `run.summary.avgScore` across all runs in the window. */
  avgScore: number;
  /** Total regressing-case count across all runs. */
  totalRegressions: number;
  /** Top-N regressions across the window, sorted by `delta` ascending (worst first). */
  topRegressions: Array<{
    caseId: string;
    score: number;
    delta: number;
    runId: string;
    suiteId: string;
  }>;
}

/**
 * Pure summariser. No I/O, no side effects.
 *
 * @returns the per-window summary stats. Useful as both the
 *          building block for `buildDigestPayload` and a directly-
 *          renderable view (e.g. the dashboard's `/admin/digest`
 *          preview page might call this without going through the
 *          payload layer).
 */
export function summariseDigest(
  digestRuns: DigestRun[],
  topN = DEFAULT_DIGEST_TOP_N,
): DigestSummary {
  if (digestRuns.length === 0) {
    return {
      totalRuns: 0,
      regressingRuns: 0,
      suites: [],
      providers: [],
      avgScore: 0,
      totalRegressions: 0,
      topRegressions: [],
    };
  }

  const allRegressions: DigestSummary['topRegressions'] = [];
  const suites = new Set<string>();
  const providers = new Set<string>();
  let regressingRuns = 0;
  let avgScoreSum = 0;

  for (const { run, deltas } of digestRuns) {
    suites.add(run.suiteId);
    providers.add(run.provider);
    avgScoreSum += run.summary.avgScore;

    const excluded = new Set([
      ...deltas.noScore,
      ...deltas.missingBaselines,
      ...deltas.staleBaselines,
    ]);
    let runHadRegression = false;

    for (const caseResult of run.cases) {
      if (excluded.has(caseResult.caseId)) continue;
      const delta = deltas.deltas[caseResult.caseId];
      if (delta === undefined) continue;
      if (deltas.regressions.includes(caseResult.caseId)) {
        allRegressions.push({
          caseId: caseResult.caseId,
          score: caseResult.score,
          delta,
          runId: run.id,
          suiteId: run.suiteId,
        });
        runHadRegression = true;
      }
    }
    if (runHadRegression) regressingRuns += 1;
  }

  // Worst regressions first (most-negative delta).
  allRegressions.sort((a, b) => a.delta - b.delta);

  return {
    totalRuns: digestRuns.length,
    regressingRuns,
    suites: [...suites].sort(),
    providers: [...providers].sort(),
    avgScore: avgScoreSum / digestRuns.length,
    totalRegressions: allRegressions.length,
    topRegressions: allRegressions.slice(0, topN),
  };
}

/**
 * Build an `AlertPayload` for the digest. Reuses the existing
 * payload shape so senders (Slack/Teams/Webhook/PagerDuty/Email)
 * render it without per-channel digest code.
 *
 * The `regressions` array carries `topRegressions` (capped at
 * `topN`); `reason` is a sentence summarising the window.
 */
export function buildDigestPayload(
  digestRuns: DigestRun[],
  options: BuildDigestOptions,
): AlertPayload {
  const topN = options.topN ?? DEFAULT_DIGEST_TOP_N;
  const summary = summariseDigest(digestRuns, topN);
  const now = options.now ?? new Date();

  // Pick a representative run (worst regression's source, falling
  // through to the latest run, falling through to a synthetic id) for
  // the payload's runId / runUrl. Senders need a single anchor URL,
  // even when the digest spans many runs.
  const anchorRun =
    pickRunById(digestRuns, summary.topRegressions[0]?.runId) ??
    digestRuns[digestRuns.length - 1]?.run;

  const reason = formatDigestReason(summary, options.windowStart, options.windowEnd);

  return {
    version: 1,
    ruleId: options.ruleId,
    ruleName: options.ruleName,
    reason,
    runId: anchorRun?.id ?? 'digest-no-runs',
    runUrl: anchorRun && options.runUrlBuilder ? options.runUrlBuilder(anchorRun) : undefined,
    suiteId:
      summary.suites.length === 1
        ? summary.suites[0]
        : `${summary.suites.length} suites`,
    provider:
      summary.providers.length === 1
        ? summary.providers[0]
        : `${summary.providers.length} providers`,
    startedAt: options.windowStart,
    avgScore: summary.avgScore,
    regressions: summary.topRegressions.map((r) => ({
      caseId: r.caseId,
      score: r.score,
      delta: r.delta,
    })),
    firedAt: now,
  };
}

function pickRunById(digestRuns: DigestRun[], id: string | undefined): RunResult | undefined {
  if (!id) return undefined;
  return digestRuns.find((d) => d.run.id === id)?.run;
}

function formatDigestReason(
  summary: DigestSummary,
  windowStart: Date,
  windowEnd: Date,
): string {
  const days = Math.max(
    1,
    Math.round((windowEnd.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000)),
  );
  if (summary.totalRuns === 0) {
    return `Past ${days}d: 0 runs ingested.`;
  }
  const partsSuites =
    summary.suites.length === 1
      ? '1 suite'
      : `${summary.suites.length} suites`;
  return (
    `Past ${days}d: ${summary.totalRuns} runs across ${partsSuites}, ` +
    `${summary.totalRegressions} regression(s) in ${summary.regressingRuns} run(s). ` +
    `Avg score ${summary.avgScore.toFixed(3)}.`
  );
}
