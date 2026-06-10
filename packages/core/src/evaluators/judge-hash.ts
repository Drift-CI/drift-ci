import type { ProviderAdapter } from '../providers/base.js';
import type { EvaluatorSpec } from '../types/index.js';
import { computeJudgeHash } from '../engine/baseline.js';
import {
  DEFAULT_JUDGE_PROMPT_TEMPLATE,
  type JudgePromptTemplate,
} from './llm-judge.js';

function extractModelFromProviderName(providerName: string): string {
  const slash = providerName.indexOf('/');
  return slash >= 0 ? providerName.slice(slash + 1) : providerName;
}

function extractBackendFromProviderName(providerName: string): string {
  const slash = providerName.indexOf('/');
  return slash >= 0 ? providerName.slice(0, slash) : providerName;
}

export function hasLLMJudge(specs: EvaluatorSpec[] | undefined): boolean {
  if (!specs) return false;
  return specs.some(
    (s) => (typeof s === 'string' ? s : s.name) === 'llm-judge',
  );
}

export interface JudgeHashFromChainOptions {
  provider: ProviderAdapter;
  promptTemplate?: JudgePromptTemplate;
}

export function judgeHashForProvider({
  provider,
  promptTemplate,
}: JudgeHashFromChainOptions): string {
  const template = promptTemplate ?? DEFAULT_JUDGE_PROMPT_TEMPLATE;
  const sample = template('drift_fence');
  return computeJudgeHash(
    extractBackendFromProviderName(provider.name),
    extractModelFromProviderName(provider.name),
    sample,
  );
}
