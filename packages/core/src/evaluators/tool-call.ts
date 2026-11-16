import type { ExpectedCall, ToolCall } from '../types/index.js';
import type { EvalInput, EvalResult, Evaluator } from './base.js';

const MAX_PROBLEMS = 3;
const VALUE_CHARS = 40;
const REASON_CHARS = 200;
const MAX_ACTUAL_META = 16;

/** Deep equality; strings compare after trim, everything else exactly. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valuesEqual(x, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ka = Object.keys(ao);
    const kb = Object.keys(bo);
    return ka.length === kb.length && ka.every((k) => k in bo && valuesEqual(ao[k], bo[k]));
  }
  return a === b;
}

const show = (v: unknown): string => {
  const s = v === undefined ? 'missing' : (JSON.stringify(v) ?? 'missing');
  return s.length > VALUE_CHARS ? `${s.slice(0, VALUE_CHARS - 1)}…` : s;
};

function cap(s: string): string {
  return s.length > REASON_CHARS ? `${s.slice(0, REASON_CHARS - 1)}…` : s;
}

/**
 * Scores the model's tool calls against `expectedCalls`. Pure; no judge.
 * Each expected call is matched (in order) to the unmatched actual call with
 * the same name and the best argument score; only listed arguments count.
 */
export class ToolCallEvaluator implements Evaluator {
  name = 'tool-call';

  constructor(private readonly expected: ExpectedCall[]) {}

  async evaluate({ toolCalls }: EvalInput): Promise<EvalResult> {
    if (!toolCalls) {
      throw new Error(
        'tool-call evaluator: the provider returned no tool-call data (does this provider support tools?)',
      );
    }
    const metadata = { expected: this.expected.length, actual: toolCalls.slice(0, MAX_ACTUAL_META) };
    if (this.expected.length === 0) {
      return toolCalls.length === 0
        ? { score: 1, reason: 'no tool call, as expected', metadata }
        : {
            score: 0,
            reason: cap(`expected no tool call, got: ${toolCalls.map((c) => c.name).join(', ')}`),
            metadata,
          };
    }
    const used = new Set<number>();
    const problems: string[] = [];
    let total = 0;
    for (const exp of this.expected) {
      const keys = Object.keys(exp.arguments);
      const argScore = (c: ToolCall) =>
        keys.length === 0
          ? 1
          : keys.filter((k) => valuesEqual(exp.arguments[k], c.arguments[k])).length / keys.length;
      let best = -1;
      let bestScore = -1;
      toolCalls.forEach((c, i) => {
        if (used.has(i) || c.name !== exp.name) return;
        const s = argScore(c);
        if (s > bestScore) {
          best = i;
          bestScore = s;
        }
      });
      if (best === -1) {
        problems.push(`missing call: ${exp.name}`);
        continue;
      }
      used.add(best);
      total += bestScore;
      for (const k of keys) {
        if (!valuesEqual(exp.arguments[k], toolCalls[best].arguments[k])) {
          problems.push(
            `${exp.name}.${k}: expected ${show(exp.arguments[k])}, got ${show(toolCalls[best].arguments[k])}`,
          );
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
