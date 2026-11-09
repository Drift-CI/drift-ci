import type { EvalInput, EvalResult, Evaluator } from './base.js';

export class ContainsEvaluator implements Evaluator {
  name = 'contains';

  constructor(private readonly required: string[]) {
    if (required.length === 0) {
      throw new Error(
        'contains evaluator requires a non-empty `contains` field on the test case.',
      );
    }
  }

  async evaluate({ output }: EvalInput): Promise<EvalResult> {
    const normalisedOutput = output.toLowerCase();
    const missing = this.required.filter(
      (value) => !normalisedOutput.includes(value.toLowerCase()),
    );
    const score = missing.length === 0 ? 1.0 : 0.0;

    return {
      score,
      reason:
        score === 1
          ? 'All required text found'
          : `Missing required text: ${missing.join(', ')}`,
    };
  }
}
