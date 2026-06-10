import type { EvalInput, EvalResult, Evaluator } from './base.js';

export interface EvaluatorWeight {
  evaluator: Evaluator;
  weight: number;
}

export class EvaluatorChain implements Evaluator {
  name = 'composite';

  constructor(private evaluators: EvaluatorWeight[]) {
    if (evaluators.length === 0) {
      throw new Error('EvaluatorChain requires at least one evaluator');
    }
    const totalWeight = evaluators.reduce((s, e) => s + e.weight, 0);
    if (Math.abs(totalWeight - 1.0) > 0.001) {
      throw new Error(
        `Evaluator weights must sum to 1.0 (got ${totalWeight.toFixed(4)}). ` +
          'Either adjust weights in suite.yaml or omit them to use equal weighting.',
      );
    }
  }

  async evaluate(input: EvalInput): Promise<EvalResult> {
    const results = await Promise.all(
      this.evaluators.map(({ evaluator }) => evaluator.evaluate(input)),
    );

    const score = results.reduce(
      (sum, result, i) => sum + result.score * this.evaluators[i].weight,
      0,
    );

    return {
      score,
      reason: results
        .map(
          (r, i) =>
            `${this.evaluators[i].evaluator.name}: ${r.score.toFixed(3)} ` +
            `(×${this.evaluators[i].weight})`,
        )
        .join(', '),
      metadata: Object.fromEntries(
        results.map((r, i) => [this.evaluators[i].evaluator.name, r]),
      ),
    };
  }
}
