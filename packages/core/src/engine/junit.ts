import type { CaseResult, RunResult } from '../types/index.js';
import type { Suite } from '../types/suite.js';
import type { DeltaReport } from './baseline.js';

export interface RenderJUnitInput {
  run: RunResult;
  suite: Suite;
  deltas: DeltaReport | null;
}

interface Classification {
  kind: 'pass' | 'failure' | 'error';
  type?: string;
  message?: string;
}

// Maps a case's terminal state to a JUnit outcome. Regressions are
// failures (behaviour change). Provider/evaluator problems are errors
// (infrastructure or instrumentation fault). Transient provider errors
// map to errors so CI doesn't flag them as regressions — the drift-ci
// circuit breaker handles aborts via exit code 2.
function classify(
  result: CaseResult,
  deltas: DeltaReport | null,
): Classification {
  if (deltas && deltas.regressions.includes(result.caseId)) {
    const delta = deltas.deltas[result.caseId];
    return {
      kind: 'failure',
      type: 'regression',
      message:
        typeof delta === 'number'
          ? `Score regressed by ${Math.abs(delta).toFixed(3)} (now ${result.score.toFixed(3)}).`
          : 'Score regressed against baseline.',
    };
  }

  switch (result.status) {
    case 'pass':
      return { kind: 'pass' };
    case 'evaluator-error':
      return {
        kind: 'error',
        type: 'evaluator-error',
        message: result.error ?? 'Evaluator threw an exception.',
      };
    case 'provider-rate-limit':
    case 'provider-network':
    case 'timeout':
      return {
        kind: 'error',
        type: result.status,
        message: result.error ?? `Transient provider error: ${result.status}.`,
      };
    case 'provider-auth':
      return {
        kind: 'error',
        type: 'provider-auth',
        message: result.error ?? 'Provider authentication failed.',
      };
    /* c8 ignore next 4 -- exhaustiveness guard for future CaseStatus values. */
    default: {
      const _exhaustive: never = result.status;
      return { kind: 'error', type: 'unknown', message: String(_exhaustive) };
    }
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      /* c8 ignore next 2 -- single-quote path is unused today but kept for completeness. */
      default:
        return '&apos;';
    }
  });
}

function durationSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0.000';
  return (ms / 1000).toFixed(3);
}

export function renderJUnitXml({
  run,
  suite,
  deltas,
}: RenderJUnitInput): string {
  const classified = run.cases.map((c) => ({ result: c, cls: classify(c, deltas) }));
  const failures = classified.filter((x) => x.cls.kind === 'failure').length;
  const errors = classified.filter((x) => x.cls.kind === 'error').length;
  const tests = classified.length;

  const totalMs =
    run.completedAt.getTime() - run.startedAt.getTime();
  const totalSeconds = durationSeconds(totalMs);

  const suiteName = escapeXml(suite.name || suite.id);
  const suiteId = escapeXml(suite.id);

  const testcases = classified
    .map(({ result, cls }) => renderTestcase(result, cls, suiteId))
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="drift-ci" tests="${tests}" failures="${failures}" errors="${errors}" time="${totalSeconds}">`,
    `  <testsuite name="${suiteName}" tests="${tests}" failures="${failures}" errors="${errors}" time="${totalSeconds}">`,
    testcases.length > 0 ? testcases : '',
    '  </testsuite>',
    '</testsuites>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function renderTestcase(
  result: CaseResult,
  cls: Classification,
  classname: string,
): string {
  const head = `    <testcase classname="${classname}" name="${escapeXml(result.caseId)}" time="${durationSeconds(result.latencyMs)}"`;

  if (cls.kind === 'pass') {
    return `${head} />`;
  }
  const tag = cls.kind; // 'failure' or 'error'
  const type = escapeXml(cls.type ?? tag);
  const message = escapeXml(cls.message ?? '');
  return `${head}>\n      <${tag} type="${type}" message="${message}" />\n    </testcase>`;
}
