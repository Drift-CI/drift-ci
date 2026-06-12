import type {
  CaseResult,
  DeltaReport,
  RunResult,
  Suite,
} from '@drift-ci/core';

export const COMMENT_MARKER = '<!-- drift-ci-comment -->';

const TRANSIENT_STATUSES: ReadonlySet<CaseResult['status']> = new Set([
  'provider-rate-limit',
  'provider-network',
  'timeout',
]);

export interface RenderCommentInput {
  run: RunResult;
  suite: Suite;
  deltas: DeltaReport;
  threshold: number;
  baselineSource: 'branch' | 'main';
  baselineChanged: string[];
  dashboardUrl?: string;
  /** sha:hex map keyed by caseId → "<short>". Optional; when omitted, stale-baseline blocks omit hash detail. */
  baselineHashes?: Record<
    string,
    { baselineSuiteHash?: string; currentSuiteHash?: string; baselineJudgeHash?: string; currentJudgeHash?: string }
  >;
}

/**
 * Pure renderer for the PR comment markdown. Output is suitable for
 * GitHub's issue-comment API and is wrapped with COMMENT_MARKER as the
 * first line so subsequent runs can find and update the same comment.
 */
export function renderComment(input: RenderCommentInput): string {
  const { run, suite, deltas, threshold, baselineSource, baselineChanged, dashboardUrl } = input;
  const { summary } = run;

  const regressionSet = new Set(deltas.regressions);
  const improvementSet = new Set(deltas.improvements);
  const staleSet = new Set(deltas.staleBaselines);
  const staleJudgeSet = new Set(deltas.staleJudges);
  const missingSet = new Set(deltas.missingBaselines);
  const noScoreSet = new Set(deltas.noScore);

  const transientCases = run.cases.filter((c) => TRANSIENT_STATUSES.has(c.status));
  const evaluatorErrorCases = run.cases.filter((c) => c.status === 'evaluator-error');

  const statusEmoji = regressionSet.size > 0 ? '🔴' : '🟢';
  const statusText =
    regressionSet.size > 0
      ? `**${regressionSet.size} regression(s) detected**`
      : '**All cases passed**';

  const headerLine =
    `${statusText} — ${summary.total} case(s), avg score ` +
    `**${formatScore(summary.avgScore)}**, avg latency **${formatLatency(summary.avgLatencyMs)}**`;

  const tableHeader = '|   | Case | Score | Δ vs baseline | Latency |\n|---|---|---|---|---|';
  const rows = run.cases
    .map((c) =>
      renderRow(c, {
        regression: regressionSet.has(c.caseId),
        improvement: improvementSet.has(c.caseId),
        stale: staleSet.has(c.caseId),
        missing: missingSet.has(c.caseId),
        noScore: noScoreSet.has(c.caseId),
        delta: deltas.deltas[c.caseId] ?? 0,
        threshold,
      }),
    )
    .join('\n');

  const sections: string[] = [
    COMMENT_MARKER,
    `## ${statusEmoji} drift-ci — \`${escapeMd(suite.name || suite.id)}\``,
    '',
    headerLine,
    '',
    tableHeader,
    rows,
  ];

  if (staleSet.size > 0) {
    sections.push('', renderStaleBaselines([...staleSet], input.baselineHashes));
  }
  if (staleJudgeSet.size > 0) {
    sections.push('', renderStaleJudges([...staleJudgeSet], input.baselineHashes));
  }
  if (transientCases.length > 0) {
    sections.push('', renderTransientBadge(transientCases));
  }
  if (evaluatorErrorCases.length > 0) {
    sections.push('', renderEvaluatorErrors(evaluatorErrorCases));
  }
  if (baselineSource === 'main' && baselineChanged.length > 0) {
    sections.push(
      '',
      `> ℹ️ This PR modifies ${baselineChanged.length} baseline file(s). With \`baseline-source: main\` ` +
        `the comparison used \`origin/main\` — branch-local baseline edits take effect on merge.`,
    );
  }

  sections.push('', renderInfoFooter(run, threshold, baselineSource, dashboardUrl));

  if (regressionSet.size > 0) {
    sections.push('', renderAcceptFooter([...regressionSet]));
  }

  sections.push('', renderRegressionExplainer(threshold));

  return sections.join('\n').trim() + '\n';
}

function renderRow(
  c: CaseResult,
  state: {
    regression: boolean;
    improvement: boolean;
    stale: boolean;
    missing: boolean;
    noScore: boolean;
    delta: number;
    threshold: number;
  },
): string {
  const icon = state.regression
    ? '🔴'
    : state.stale
      ? '⚠️'
      : c.status === 'evaluator-error'
        ? '🟠'
        : TRANSIENT_STATUSES.has(c.status)
          ? '🟡'
          : state.improvement
            ? '🟢'
            : '🟢';

  const score = state.noScore ? '—' : formatScore(c.score);

  let deltaCell: string;
  if (state.missing) {
    deltaCell = '_no baseline_';
  } else if (state.noScore) {
    deltaCell = '—';
  } else if (state.stale) {
    deltaCell = '_stale_';
  } else if (state.regression) {
    deltaCell = `**${formatDelta(state.delta)}** ⚠️`;
  } else {
    deltaCell = formatDelta(state.delta);
  }

  return `| ${icon} | \`${escapeMd(c.caseId)}\` | ${score} | ${deltaCell} | ${formatLatency(c.latencyMs)} |`;
}

function renderStaleBaselines(
  caseIds: string[],
  hashes: RenderCommentInput['baselineHashes'],
): string {
  // Canonical per-arch §6 ("Stale-baseline warning (canonical)"). One block
  // per stale case so reviewers see the full guidance verbatim.
  const blocks = caseIds.map((id) => {
    const hashInfo = hashes?.[id];
    const baselineHash = shortHash(hashInfo?.baselineSuiteHash);
    const currentHash = shortHash(hashInfo?.currentSuiteHash);
    const hashLine =
      baselineHash && currentHash
        ? ` (baseline suiteHash: \`${baselineHash}\` · current suiteHash: \`${currentHash}\`)`
        : '';
    return [
      '> ⚠️ **Stale baseline.**',
      `> Baseline for \`${escapeMd(id)}\` was captured against a different suite definition${hashLine}.`,
      `> Review the input/expected/criteria/evaluators/threshold diff, then either revert the suite change or run:`,
      `>     drift-ci baseline accept --cases ${id}`,
      '> and commit the refreshed baseline in this PR.',
    ].join('\n');
  });
  return blocks.join('\n>\n');
}

function renderStaleJudges(
  caseIds: string[],
  hashes: RenderCommentInput['baselineHashes'],
): string {
  // Canonical per arch §6 / v1.3 D1 — judge-provider drift is informational,
  // not a regression. Use ℹ️ instead of ⚠️.
  const blocks = caseIds.map((id) => {
    const hashInfo = hashes?.[id];
    const baselineHash = shortHash(hashInfo?.baselineJudgeHash);
    const currentHash = shortHash(hashInfo?.currentJudgeHash);
    const hashLine =
      baselineHash && currentHash
        ? ` (baseline judgeHash: \`${baselineHash}\` · current judgeHash: \`${currentHash}\`)`
        : '';
    return [
      '> ℹ️ **Stale judge.**',
      `> Baseline for \`${escapeMd(id)}\` was captured against a different judge provider${hashLine}.`,
      `> The score is informational — re-baseline when the swap is intentional:`,
      `>     drift-ci baseline accept --cases ${id}`,
    ].join('\n');
  });
  return blocks.join('\n>\n');
}

function renderTransientBadge(cases: CaseResult[]): string {
  const grouped = new Map<string, string[]>();
  for (const c of cases) {
    const list = grouped.get(c.status) ?? [];
    list.push(c.caseId);
    grouped.set(c.status, list);
  }
  const lines = [...grouped.entries()].map(
    ([status, ids]) => `> - \`${status}\`: ${ids.map((id) => `\`${escapeMd(id)}\``).join(', ')}`,
  );
  return [
    `> ❗ **Transient provider failures** for ${cases.length} case(s). These are not regressions — re-run when the upstream provider recovers.`,
    ...lines,
  ].join('\n');
}

function renderEvaluatorErrors(cases: CaseResult[]): string {
  const ids = cases.map((c) => `\`${escapeMd(c.caseId)}\``).join(', ');
  return `> 🟠 **Evaluator errors** for ${cases.length} case(s): ${ids}. These cases have no score and are excluded from delta math.`;
}

function renderInfoFooter(
  run: RunResult,
  threshold: number,
  baselineSource: 'branch' | 'main',
  dashboardUrl?: string,
): string {
  const dashboardLink = dashboardUrl
    ? ` · [📊 dashboard](${dashboardUrl}/runs/${encodeURIComponent(run.id)})`
    : '';
  return [
    `<sub>Provider: \`${escapeMd(run.provider)}\` · Run \`${run.id}\` · Threshold: ${threshold} · Baseline: \`${baselineSource}\`${dashboardLink}</sub>`,
  ].join('\n');
}

function renderAcceptFooter(regressedCaseIds: string[]): string {
  const csv = regressedCaseIds.join(',');
  return [
    '<details>',
    '<summary>✅ If these regressions are intentional</summary>',
    '',
    'Each baseline lives at `.drift/baseline/<case-id>.json`. Run locally to update them, then commit:',
    '',
    '```bash',
    `npx drift-ci baseline accept --cases ${csv}`,
    'git add .drift/baseline/',
    'git commit -m "Update baseline: <describe the intended behavior change>"',
    'git push',
    '```',
    '',
    'The reviewer will see the old → new output diff for each accepted case. **Only accept regressions you have verified are correct behavior.**',
    '',
    '</details>',
  ].join('\n');
}

function renderRegressionExplainer(threshold: number): string {
  return [
    '<details>',
    '<summary>What is a regression?</summary>',
    '',
    `A regression occurs when a case's score drops more than **${(threshold * 100).toFixed(0)}%** below the committed baseline. ` +
      'Each baseline lives at `.drift/baseline/<case-id>.json` in this repo — the committed file is the canonical baseline, ' +
      'and reviewing changes to it is how intentional behaviour changes get approved.',
    '',
    '</details>',
  ].join('\n');
}

function shortHash(h?: string): string | undefined {
  if (!h) return undefined;
  // Strip a leading "sha256:" prefix if present, then take the first 8 chars.
  const cleaned = h.replace(/^sha256:/, '');
  return cleaned.slice(0, 8);
}

function formatScore(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : '—';
}

function formatDelta(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(3)}`;
}

function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function escapeMd(s: string): string {
  // Minimal escaping — case IDs and suite names go through table cells and
  // inline code spans, so only ` and | matter. Escape backslashes FIRST so an
  // attacker-supplied `\` can't neutralise the `\|` escape that follows and
  // break out of the table cell. Backticks are swapped for a homoglyph (they
  // can't be reliably backslash-escaped inside a cell).
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, 'ˋ');
}

// ──────────────────────────────────────────────────────────────────────────
// Posting

export interface CommentApi {
  list(params: { owner: string; repo: string; issueNumber: number }): Promise<
    Array<{ id: number; body?: string | null }>
  >;
  update(params: {
    owner: string;
    repo: string;
    commentId: number;
    body: string;
  }): Promise<void>;
  create(params: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  }): Promise<{ id: number }>;
}

export interface PrContext {
  owner: string;
  repo: string;
  prNumber: number;
}

export function findExistingCommentId(
  comments: ReadonlyArray<{ id: number; body?: string | null }>,
  marker = COMMENT_MARKER,
): number | null {
  for (const c of comments) {
    if (c.body && c.body.includes(marker)) return c.id;
  }
  return null;
}

export async function postOrUpdateComment(
  api: CommentApi,
  ctx: PrContext,
  body: string,
): Promise<{ action: 'created' | 'updated'; id: number }> {
  const existing = await api.list({
    owner: ctx.owner,
    repo: ctx.repo,
    issueNumber: ctx.prNumber,
  });
  const matchId = findExistingCommentId(existing);
  if (matchId !== null) {
    await api.update({
      owner: ctx.owner,
      repo: ctx.repo,
      commentId: matchId,
      body,
    });
    return { action: 'updated', id: matchId };
  }
  const created = await api.create({
    owner: ctx.owner,
    repo: ctx.repo,
    issueNumber: ctx.prNumber,
    body,
  });
  return { action: 'created', id: created.id };
}
