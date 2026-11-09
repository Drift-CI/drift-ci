import type { CaseResult, CaseStatus, TokenUsage } from '../types/index.js';

/** Per-sample record kept in `evaluatorBreakdown.samples` (NaN → null so it survives JSON). */
export interface SampleRecord {
  score: number | null;
  status: CaseStatus;
}

/** Samples for a case: the case's own `runs`, else the suite's `default_runs`, else 1. */
export function effectiveRuns(caseRuns: number | undefined, suiteDefault: number | undefined): number {
  return caseRuns ?? suiteDefault ?? 1;
}

/** Median of a non-empty list; an even count averages the two middle values. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Field-wise sum of the usages that were reported; undefined when none were. */
export function sumUsage(usages: readonly (TokenUsage | undefined)[]): TokenUsage | undefined {
  const present = usages.filter((u): u is TokenUsage => u !== undefined);
  if (present.length === 0) return undefined;
  const total: TokenUsage = {
    inputTokens: present.reduce((a, u) => a + u.inputTokens, 0),
    outputTokens: present.reduce((a, u) => a + u.outputTokens, 0),
    totalTokens: present.reduce((a, u) => a + u.totalTokens, 0),
  };
  if (present.some((u) => u.cachedInputTokens !== undefined)) {
    total.cachedInputTokens = present.reduce((a, u) => a + (u.cachedInputTokens ?? 0), 0);
  }
  return total;
}

function isScored(s: CaseResult): boolean {
  return s.status === 'pass' && Number.isFinite(s.score);
}

/**
 * Combine N samples of one case into one result (spec: repeated-sampling design).
 * - 1 sample: returned as-is.
 * - At least ceil(N/2) scored: median score; output/breakdown/latency from the scored sample closest to it.
 * - Otherwise: the most common failure status (ties → first seen), score NaN.
 * Token usage is summed over every sample so cost reflects real spend.
 */
export function aggregateSamples(samples: readonly CaseResult[]): CaseResult {
  if (samples.length === 1) return samples[0];

  const records: SampleRecord[] = samples.map((s) => ({
    score: Number.isFinite(s.score) ? s.score : null,
    status: s.status,
  }));
  const tokenUsage = sumUsage(samples.map((s) => s.tokenUsage));
  const scored = samples.filter(isScored);

  let chosen: CaseResult;
  let score: number;
  if (scored.length >= Math.ceil(samples.length / 2)) {
    score = median(scored.map((s) => s.score));
    chosen = scored[0];
    for (const s of scored) {
      if (Math.abs(s.score - score) < Math.abs(chosen.score - score)) chosen = s;
    }
    chosen = { ...chosen, status: 'pass', error: undefined };
  } else {
    const failed = samples.filter((s) => !isScored(s));
    const counts = new Map<CaseStatus, number>();
    for (const s of failed) counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
    let status = failed[0].status;
    for (const [st, n] of counts) if (n > (counts.get(status) ?? 0)) status = st;
    chosen = failed.find((s) => s.status === status) as CaseResult;
    score = NaN;
  }

  const result: CaseResult = {
    ...chosen,
    score,
    evaluatorBreakdown: { ...(chosen.evaluatorBreakdown ?? {}), samples: records },
  };
  if (result.error === undefined) delete result.error;
  if (tokenUsage) result.tokenUsage = tokenUsage;
  else delete result.tokenUsage;
  return result;
}

/** How many samples produced this result (1 when it has no `samples` metadata). */
export function sampleCount(c: Pick<CaseResult, 'evaluatorBreakdown'>): number {
  const s = c.evaluatorBreakdown?.samples;
  return Array.isArray(s) && s.length > 0 ? s.length : 1;
}
