export interface EvalInput {
  input: string;
  output: string;
  expected?: string;
  criteria?: string;
  systemPrompt?: string;
}

export interface EvalResult {
  score: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface Evaluator {
  name: string;
  evaluate(input: EvalInput): Promise<EvalResult>;
}
