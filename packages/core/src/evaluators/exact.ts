import type { EvalInput, EvalResult, Evaluator } from './base.js';

export class ExactMatchEvaluator implements Evaluator {
  name = 'exact-match';

  async evaluate({ output, expected }: EvalInput): Promise<EvalResult> {
    if (expected === undefined) {
      throw new Error('exact-match requires expected output');
    }

    const normalise = (s: string) => s.trim().toLowerCase();
    const score = normalise(output) === normalise(expected) ? 1.0 : 0.0;
    return { score, reason: score === 1 ? 'Exact match' : 'No match' };
  }
}

export class RegexMatchEvaluator implements Evaluator {
  name = 'regex-match';

  constructor(
    private pattern: string,
    private flags = 'i',
  ) {}

  async evaluate({ output }: EvalInput): Promise<EvalResult> {
    const re = new RegExp(this.pattern, this.flags);
    const score = re.test(output) ? 1.0 : 0.0;
    return {
      score,
      reason: score === 1 ? 'Pattern matched' : 'Pattern not found',
    };
  }
}
