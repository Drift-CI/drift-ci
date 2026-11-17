import type { ExpectedCall, ToolCall } from '../types/index.js';
import type { EvalInput, EvalResult, Evaluator } from './base.js';
import { valuesEqual } from './args-match.js';

const MAX_PROBLEMS = 3;
const VALUE_CHARS = 40;
const REASON_CHARS = 200;
const MAX_ACTUAL_META = 16;
/** Actual calls considered for matching; the rest count as unexpected. */
const MAX_MATCHED = 16;
const EPS = 1e-9;

const show = (v: unknown): string => {
  const s = v === undefined ? 'missing' : (JSON.stringify(v) ?? 'missing');
  return s.length > VALUE_CHARS ? `${s.slice(0, VALUE_CHARS - 1)}…` : s;
};

function cap(s: string): string {
  return s.length > REASON_CHARS ? `${s.slice(0, REASON_CHARS - 1)}…` : s;
}

/**
 * Scores the model's tool calls against `expectedCalls`. Pure; no judge.
 * Expected calls are assigned to same-name actual calls so the total argument
 * score is maximal (order-independent; ties keep the earliest actual calls).
 */
export class ToolCallEvaluator implements Evaluator {
  name = 'tool-call';

  constructor(private readonly expected: ExpectedCall[]) {}

  async evaluate({ toolCalls, toolLoop }: EvalInput): Promise<EvalResult> {
    if (!toolCalls) {
      throw new Error(
        'tool-call evaluator: the provider returned no tool-call data (does this provider support tools?)',
      );
    }
    const metadata = {
      expected: this.expected.length,
      actual: toolCalls.slice(0, MAX_ACTUAL_META),
      ...(toolLoop ? { toolLoop } : {}),
    };
    if (this.expected.length === 0) {
      return toolCalls.length === 0
        ? { score: 1, reason: 'no tool call, as expected', metadata }
        : {
            score: 0,
            reason: cap(`expected no tool call, got: ${toolCalls.map((c) => c.name).join(', ')}`),
            metadata,
          };
    }
    const m = Math.min(toolCalls.length, MAX_MATCHED);
    const n = this.expected.length;
    const unparsed = (c: ToolCall) => Object.prototype.hasOwnProperty.call(c.arguments, '__unparsed');
    const argScore = (exp: ExpectedCall, c: ToolCall): number => {
      if (unparsed(c)) return 0;
      const keys = Object.keys(exp.arguments);
      return keys.length === 0
        ? 1
        : keys.filter((k) => valuesEqual(exp.arguments[k], c.arguments[k])).length / keys.length;
    };
    // Score every expected/actual pair once; the DP below only looks these up.
    // null = different tool names, so the pair can never match.
    const scores: (number | null)[][] = this.expected.map((exp) =>
      toolCalls.slice(0, m).map((c) => (exp.name === c.name ? argScore(exp, c) : null)),
    );
    const pair = (i: number, j: number): number | null => scores[i][j];

    // Optimal assignment: best[i][mask] = max total for expected i.. with the actual calls in mask used.
    // Only masks with at most i bits set are reachable when expected call i is
    // placed, and each expected call only tries same-name actual calls.
    const size = 1 << m;
    const bits = new Uint8Array(size);
    for (let mask = 1; mask < size; mask++) bits[mask] = bits[mask >> 1] + (mask & 1);
    const candidates = scores.map((row) =>
      row.flatMap((s, j) => (s === null ? [] : [[j, s] as const])),
    );
    const best: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(size));
    for (let i = n - 1; i >= 0; i--) {
      const next = best[i + 1];
      const cur = best[i];
      const cands = candidates[i];
      for (let mask = 0; mask < size; mask++) {
        if (bits[mask] > i) continue;
        let v = next[mask];
        for (const [j, s] of cands) {
          const bit = 1 << j;
          if (mask & bit) continue;
          const cand = s + next[mask | bit];
          if (cand > v) v = cand;
        }
        cur[mask] = v;
      }
    }
    // Reconstruct, preferring the earliest actual call among equal totals, then a match over a skip.
    const used = new Set<number>();
    const problems: string[] = [];
    let total = 0;
    let mask = 0;
    for (let i = 0; i < n; i++) {
      const exp = this.expected[i];
      let pick = -1;
      let pickScore = 0;
      for (let j = 0; j < m; j++) {
        if (mask & (1 << j)) continue;
        const s = pair(i, j);
        if (s === null) continue;
        if (Math.abs(s + best[i + 1][mask | (1 << j)] - best[i][mask]) < EPS) {
          pick = j;
          pickScore = s;
          break;
        }
      }
      if (pick === -1) {
        problems.push(`missing call: ${exp.name}`);
        continue;
      }
      used.add(pick);
      mask |= 1 << pick;
      total += pickScore;
      const actual = toolCalls[pick];
      if (unparsed(actual)) {
        problems.push(`${exp.name}: arguments were not valid JSON`);
        continue;
      }
      for (const k of Object.keys(exp.arguments)) {
        if (!valuesEqual(exp.arguments[k], actual.arguments[k])) {
          problems.push(`${exp.name}.${k}: expected ${show(exp.arguments[k])}, got ${show(actual.arguments[k])}`);
        }
      }
    }
    toolCalls.forEach((c, i) => {
      if (!used.has(i)) problems.push(`unexpected call: ${c.name}`);
    });
    const score = total / Math.max(this.expected.length, toolCalls.length);
    const reason =
      problems.length === 0
        ? `all ${this.expected.length} calls matched`
        : cap(problems.slice(0, MAX_PROBLEMS).join('; '));
    return { score, reason, metadata };
  }
}
