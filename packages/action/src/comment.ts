import type {
  CaseResult,
  DeltaReport,
  RunResult,
  Suite,
} from '@drift-ci/core';
import { sampleCount } from '@drift-ci/core';

import { lineDiff, type BaselineChange } from './baseline-changes.js';

export const COMMENT_MARKER = '<!-- drift-ci-comment -->';

const TRANSIENT_STATUSES: ReadonlySet<CaseResult['status']> = new Set([
  'provider-rate-limit',
  'provider-network',
  'timeout',
]);

export interface RenderCommentInput {
  run: RunResult;
  suite: Suite;
  /** Suite path the action ran with; rendered into copy-paste `baseline accept` commands. */
  suitePath: string;
  deltas: DeltaReport;
  threshold: number;
  baselineSource: 'branch' | 'main';
  baselineChanged: string[];
  /** Per-case changes for the "Baselines changed in this PR" section. */
  baselineChanges?: BaselineChange[];
  /** Number of changed baseline files that could not be parsed and were skipped. */
  baselineSkipped?: number;
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
  const full = renderCommentWith(input, false);
  return full.length > MAX_COMMENT_CHARS ? renderCommentWith(input, true) : full;
}

const MAX_COMMENT_CHARS = 65_000;

function renderCommentWith(input: RenderCommentInput, compact: boolean): string {
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

  const baselineSection = safeBaselineSection(input, compact);
  if (baselineSection) sections.push('', baselineSection);

  if (staleSet.size > 0) {
    sections.push('', renderStaleBaselines([...staleSet], input.suitePath, input.baselineHashes));
  }
  if (staleJudgeSet.size > 0) {
    sections.push('', renderStaleJudges([...staleJudgeSet], input.suitePath, input.baselineHashes));
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
    sections.push('', renderAcceptFooter([...regressionSet], input.suitePath));
  }

  sections.push('', renderRegressionExplainer(threshold));

  return sections.join('\n').trim() + '\n';
}

const MAX_DIFF_LINES = 60;
const MAX_DIFFS = 10;
const MAX_TABLE_ROWS = 50;
const MAX_ID_CHARS = 120;
const DIFF_BUDGET_CHARS = 30_000;

/** Never lets a rendering failure take down the whole comment. */
function safeBaselineSection(input: RenderCommentInput, compact: boolean): string {
  try {
    return renderBaselineChanges(input.baselineChanges ?? [], {
      skipped: input.baselineSkipped,
      compact,
    });
  } catch {
    return '';
  }
}

/** Case ID safe for one line of markdown/HTML: no control chars, bounded, never empty. */
function displayId(id: string): string {
  const cleaned = stripControl(String(id)).trim();
  if (cleaned === '') return 'unnamed';
  const chars = [...cleaned];
  return chars.length > MAX_ID_CHARS ? chars.slice(0, MAX_ID_CHARS).join('') + '…' : cleaned;
}

function stripControl(s: string): string {
  return s.replace(new RegExp('[\u0000-\u001f\u007f\u2028\u2029]', 'g'), ' ');
}

function htmlEscapeId(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;');
}

export interface BaselineSectionOptions {
  /** Files that could not be parsed and were skipped. */
  skipped?: number;
  /** Heading + summary only (used when the whole comment is too large). */
  compact?: boolean;
}

/**
 * Renders the "Baselines changed in this PR" section ('' when there is
 * nothing to show). Baseline output is untrusted model text: each diff is
 * fenced with a backtick run longer than any run inside it.
 */
export function renderBaselineChanges(
  changes: BaselineChange[],
  opts: BaselineSectionOptions = {},
): string {
  const skipped = opts.skipped ?? 0;
  const listed = changes.filter((c) => c.kind !== 'unchanged');
  const unchangedCount = changes.length - listed.length;
  const out: string[] = [];
  const skippedLine = `<sub>${skipped} baseline file(s) could not be read and are not shown.</sub>`;

  if (listed.length === 0) {
    if (unchangedCount > 0) {
      out.push(
        `<sub>📝 ${unchangedCount} baseline file(s) re-captured with no score or output change.</sub>`,
      );
    }
    if (skipped > 0) out.push(skippedLine);
    return out.join('\n\n');
  }

  const count = (k: BaselineChange['kind']): number => listed.filter((c) => c.kind === k).length;
  out.push(`### 📝 Baselines changed in this PR (${listed.length})`);
  const labels: Array<[BaselineChange['kind'], string]> = [
    ['lowered', 'lowered'],
    ['raised', 'raised'],
    ['output-changed', 'output changed'],
    ['added', 'added'],
    ['removed', 'removed'],
  ];
  out.push(
    labels
      .filter(([k]) => count(k) > 0)
      .map(([k, label]) => `${count(k)} ${label}`)
      .join(' · '),
  );

  if (opts.compact) {
    out.push(
      '',
      "_Details omitted to keep this comment within GitHub's size limit; see *Files changed*._",
    );
    if (skipped > 0) out.push('', skippedLine);
    return out.join('\n');
  }

  if (count('lowered') > 0) {
    out.push(
      '',
      '> ⚠️ **Lowering a baseline accepts worse behaviour as the new normal.** Check the output diffs below before approving.',
    );
  }
  out.push('', '| Case | Baseline score | Change |', '|---|---|---|');
  for (const c of listed.slice(0, MAX_TABLE_ROWS)) out.push(renderBaselineRow(c));
  if (listed.length > MAX_TABLE_ROWS) {
    out.push(`| … ${listed.length - MAX_TABLE_ROWS} more — see *Files changed* | | |`);
  }

  if (unchangedCount > 0) {
    out.push('', `<sub>Plus ${unchangedCount} re-captured with no score or output change.</sub>`);
  }
  if (skipped > 0) out.push('', skippedLine);

  const diffable = listed.filter(
    (c) =>
      (c.kind === 'lowered' || c.kind === 'raised' || c.kind === 'output-changed') &&
      (c.oldOutput ?? '') !== (c.newOutput ?? ''),
  );
  let used = out.join('\n').length;
  let shown = 0;
  for (const c of diffable.slice(0, MAX_DIFFS)) {
    const block = renderOutputDiff(c);
    if (used + block.length > DIFF_BUDGET_CHARS) break;
    used += block.length;
    out.push('', block);
    shown++;
  }
  if (shown < diffable.length) {
    out.push(
      '',
      `_${diffable.length - shown} more output diff(s) omitted to keep this comment within GitHub's size limit; see *Files changed*._`,
    );
  }
  return out.join('\n');
}

function renderBaselineRow(c: BaselineChange): string {
  const id = `\`${escapeMd(displayId(c.caseId))}\``;
  const oldS = c.oldScore === undefined ? '' : c.oldScore.toFixed(3);
  const newS = c.newScore === undefined ? '' : c.newScore.toFixed(3);
  const scores = `${oldS} → ${newS}`.trim();
  const delta = (c.newScore ?? 0) - (c.oldScore ?? 0);
  let change: string;
  if (c.kind === 'lowered') change = `**${formatDelta(delta)}** ⬇️`;
  else if (c.kind === 'raised') change = formatDelta(delta);
  else if (c.kind === 'output-changed') change = 'output changed';
  else change = c.kind;
  return `| ${id} | ${scores} | ${change} |`;
}

function renderOutputDiff(c: BaselineChange): string {
  const lines = lineDiff(c.oldOutput ?? '', c.newOutput ?? '').map((l) =>
    l.op === ' ' ? `  ${l.text}` : `${l.op} ${l.text}`,
  );
  if (lines.length > MAX_DIFF_LINES) {
    const more = lines.length - MAX_DIFF_LINES;
    lines.length = MAX_DIFF_LINES;
    lines.push(`… ${more} more lines`);
  }
  const body = lines.join('\n');
  let longest = 0;
  for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const id = htmlEscapeId(displayId(c.caseId));
  return `<details><summary>Output diff: <code>${id}</code></summary>\n\n${fence}diff\n${body}\n${fence}\n</details>`;
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

  const samples = sampleCount(c);
  const score =
    (state.noScore ? '—' : formatScore(c.score)) +
    (samples > 1 ? ` <sub>${state.noScore ? `${samples} samples` : `median of ${samples}`}</sub>` : '');

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
  suitePath: string,
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
      `>     ${acceptCommand(suitePath, id)}`,
      '> and commit the refreshed baseline in this PR.',
    ].join('\n');
  });
  return blocks.join('\n>\n');
}

function renderStaleJudges(
  caseIds: string[],
  suitePath: string,
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
      `>     ${acceptCommand(suitePath, id)}`,
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

function renderAcceptFooter(regressedCaseIds: string[], suitePath: string): string {
  const csv = regressedCaseIds.join(',');
  return [
    '<details>',
    '<summary>✅ If these regressions are intentional</summary>',
    '',
    'Each baseline lives at `.drift/baseline/<case-id>.json`. Run locally to update them, then commit:',
    '',
    '```bash',
    acceptCommand(suitePath, csv),
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

function acceptCommand(suitePath: string, caseIds: string): string {
  const arg = /^[\w@%+=:,./-]+$/.test(suitePath)
    ? suitePath
    : "'" + suitePath.replace(/'/g, "'\\''") + "'";
  return `npx @drift-ci/cli baseline accept ${arg} --cases ${caseIds}`;
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
  return stripControl(s)
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
