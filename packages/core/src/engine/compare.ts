import type { RunResult, Suite } from '../types/index.js';

/**
 * Multi-provider comparison helper. (arch §15)
 *
 * Pure: takes in a list of `RunResult`s and the `Suite` they were
 * evaluated against, returns a `ComparisonReport` with one row per
 * case and a per-provider summary. The CLI's `compare` command and
 * the dashboard's `/compare` page both layer rendering on top of
 * this — the helper itself does no I/O and no formatting.
 *
 * "Winner" semantics:
 * - Per-row winner = the provider whose case score is strictly
 *   greatest. Ties produce `null` (no winner column highlight).
 * - Per-suite winner = the provider with the strictly-greatest
 *   `summary.avgScore`. Ties produce `null`.
 *
 * Cases that didn't run on a particular provider (e.g. that
 * provider's run hit a transient storm and the case was skipped)
 * surface as `null` in the row — the renderer shows a dash and the
 * winner is computed across the providers that DID score the case.
 */

export interface ComparisonRow {
  caseId: string;
  /** One slot per provider in input order. `null` when that provider has no result for the case. */
  scores: Array<number | null>;
  /** `null` if no provider scored the case, OR if there's a tie at the top. */
  winnerIndex: number | null;
}

export interface ComparisonProviderSummary {
  /** Provider display name, taken from `RunResult.provider`. */
  provider: string;
  runId: string;
  avgScore: number;
  /** Cases the provider didn't score (skipped / transient / missing). */
  missingCount: number;
  /** Number of rows where this provider was the strict per-case winner. */
  winsCount: number;
}

export interface ComparisonReport {
  suiteId: string;
  suiteName: string;
  providers: ComparisonProviderSummary[];
  rows: ComparisonRow[];
  /** Index of provider with the strictly-highest avg score; null on tie. */
  overallWinnerIndex: number | null;
}

export function buildComparison(
  runs: RunResult[],
  suite: Suite,
): ComparisonReport {
  if (runs.length < 2) {
    throw new Error(
      `buildComparison requires at least 2 runs (got ${runs.length}). ` +
        `Pass two or more providers via --providers or compare two existing run-ids.`,
    );
  }

  const rows: ComparisonRow[] = suite.cases.map((tc) => {
    const scores = runs.map((run) => {
      const result = run.cases.find((c) => c.caseId === tc.id);
      if (!result) return null;
      // Treat NaN as "no score" so it doesn't poison Math.max.
      if (Number.isNaN(result.score)) return null;
      return result.score;
    });
    return {
      caseId: tc.id,
      scores,
      winnerIndex: pickWinnerIndex(scores),
    };
  });

  const winsByProvider = new Array(runs.length).fill(0) as number[];
  for (const r of rows) {
    if (r.winnerIndex !== null) winsByProvider[r.winnerIndex] += 1;
  }

  const providers: ComparisonProviderSummary[] = runs.map((run, idx) => ({
    provider: run.provider,
    runId: run.id,
    avgScore: run.summary.avgScore,
    missingCount: rows.filter((r) => r.scores[idx] === null).length,
    winsCount: winsByProvider[idx],
  }));

  return {
    suiteId: suite.id,
    suiteName: suite.name,
    providers,
    rows,
    overallWinnerIndex: pickWinnerIndex(providers.map((p) => p.avgScore)),
  };
}

function pickWinnerIndex(scores: Array<number | null>): number | null {
  let max = -Infinity;
  let maxCount = 0;
  let maxIdx = -1;
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    if (s === null) continue;
    if (s > max) {
      max = s;
      maxCount = 1;
      maxIdx = i;
    } else if (s === max) {
      maxCount += 1;
    }
  }
  if (maxIdx === -1 || maxCount > 1) return null;
  return maxIdx;
}

// ─── renderers ──────────────────────────────────────────────────────────

export interface RenderTableOptions {
  /** Inject ANSI colour codes around the per-row winner. */
  color?: boolean;
  /** Override the case-id column width. Default: max(15, longest case id). */
  caseColumnWidth?: number;
  /** Override the per-provider column width. Default: 12. */
  providerColumnWidth?: number;
}

const ANSI_GREEN = '\x1b[32m';
const ANSI_RESET = '\x1b[0m';
const ANSI_BOLD = '\x1b[1m';

/**
 * Plain-text comparison table. Lines are pre-trimmed so callers can
 * pipe the output into any reporter / file / CI annotation without
 * worrying about trailing whitespace.
 */
export function renderComparisonTable(
  report: ComparisonReport,
  options: RenderTableOptions = {},
): string {
  const color = options.color ?? false;
  const caseWidth =
    options.caseColumnWidth ??
    Math.max(15, ...report.rows.map((r) => r.caseId.length));
  const colWidth = options.providerColumnWidth ?? 14;

  const headers = report.providers.map((p) => providerLabel(p.provider, colWidth));
  const lines: string[] = [];

  lines.push(`Suite: ${report.suiteName} (${report.suiteId})`);
  lines.push('');

  // Header
  lines.push(
    pad('Case', caseWidth) +
      headers.map((h) => pad(h, colWidth)).join('') +
      pad('Winner', colWidth),
  );
  lines.push(
    '─'.repeat(caseWidth + colWidth * report.providers.length + colWidth),
  );

  for (const row of report.rows) {
    const cells = row.scores.map((s, idx) => {
      const text = s === null ? '—' : s.toFixed(3);
      const padded = pad(text, colWidth);
      if (color && row.winnerIndex === idx) {
        return `${ANSI_GREEN}${padded}${ANSI_RESET}`;
      }
      return padded;
    });
    const winner =
      row.winnerIndex === null
        ? 'tie'
        : shortName(report.providers[row.winnerIndex].provider);
    lines.push(pad(row.caseId, caseWidth) + cells.join('') + pad(winner, colWidth));
  }

  // Summary
  lines.push(
    '─'.repeat(caseWidth + colWidth * report.providers.length + colWidth),
  );
  const avgCells = report.providers.map((p, idx) => {
    const text = p.avgScore.toFixed(3);
    const padded = pad(text, colWidth);
    if (color && report.overallWinnerIndex === idx) {
      return `${ANSI_BOLD}${ANSI_GREEN}${padded}${ANSI_RESET}`;
    }
    return padded;
  });
  lines.push(pad('Average', caseWidth) + avgCells.join(''));

  const winsCells = report.providers.map((p) =>
    pad(`${p.winsCount}/${report.rows.length}`, colWidth),
  );
  lines.push(pad('Wins', caseWidth) + winsCells.join(''));

  if (report.providers.some((p) => p.missingCount > 0)) {
    const missingCells = report.providers.map((p) =>
      pad(p.missingCount === 0 ? '0' : String(p.missingCount), colWidth),
    );
    lines.push(pad('Missing', caseWidth) + missingCells.join(''));
  }

  return lines.join('\n');
}

/** JSON variant — same data, machine-readable. */
export function renderComparisonJson(report: ComparisonReport): string {
  return JSON.stringify(report, null, 2);
}

// ─── helpers ────────────────────────────────────────────────────────────

function pad(s: string, width: number): string {
  if (s.length >= width) return `${s.slice(0, width - 1)} `;
  return s + ' '.repeat(width - s.length);
}

/** `provider/model` → `model` for tighter columns; passthrough otherwise. */
function shortName(provider: string): string {
  const slash = provider.indexOf('/');
  return slash >= 0 ? provider.slice(slash + 1) : provider;
}

function providerLabel(provider: string, width: number): string {
  const short = shortName(provider);
  if (short.length <= width - 1) return short;
  return short.slice(0, width - 2) + '…';
}
