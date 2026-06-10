import _Ajv, { type Ajv as AjvInstance, type ValidateFunction } from 'ajv';
import _addFormats from 'ajv-formats';

import type { EvalInput, EvalResult, Evaluator } from './base.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvCtor: new (opts?: unknown) => AjvInstance =
  (_Ajv as any).default ?? (_Ajv as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const applyFormats: (ajv: AjvInstance) => void =
  (_addFormats as any).default ?? (_addFormats as any);

const ajv = new AjvCtor({ allErrors: true, strict: false });
applyFormats(ajv);

export class SchemaEvaluator implements Evaluator {
  name = 'json-schema';
  private validateFn?: ValidateFunction;

  constructor(schema?: Record<string, unknown>) {
    if (schema && Object.keys(schema).length > 0) {
      this.validateFn = ajv.compile(schema);
    }
  }

  async evaluate({ output }: EvalInput): Promise<EvalResult> {
    if (!this.validateFn) {
      throw new Error(
        'json-schema evaluator requires a `schema` field on the test case. ' +
          'Add `schema: { type: object, ... }` to the case in suite.yaml.',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      return { score: 0, reason: 'Output is not valid JSON' };
    }

    const valid = this.validateFn(parsed);
    if (valid) return { score: 1, reason: 'Schema valid' };

    const errors = this.validateFn.errors
      ?.map((e) => `${e.instancePath || '(root)'} ${e.message ?? ''}`.trim())
      .join('; ');
    return { score: 0, reason: `Schema invalid: ${errors}` };
  }
}
