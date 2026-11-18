import type { ToolCall } from '../types/index.js';

export interface EvalInput {
  input: string;
  output: string;
  expected?: string;
  criteria?: string;
  systemPrompt?: string;
  context?: string[];
  /** The model's tool calls, when the case offered tools. */
  toolCalls?: ToolCall[];
  /** Set for a multi-step case (`toolResults`): provider calls made and whether `maxSteps` cut it off. */
  toolLoop?: { steps: number; stoppedAtStepLimit: boolean };
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
