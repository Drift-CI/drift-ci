import type { ProviderAdapter } from '../providers/base.js';
import type { EvaluatorSpec, Suite } from '../types/index.js';
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

/** Evaluators that require a judge provider to be resolved. */
const JUDGE_EVALUATORS = new Set(['llm-judge', 'rubric-checklist']);

function specsNeedJudge(specs: EvaluatorSpec[] | undefined): boolean {
  return (
    specs?.some((s) =>
      JUDGE_EVALUATORS.has(typeof s === 'string' ? s : s.name),
    ) ?? false
  );
}

/**
 * Whether any evaluator in the suite needs a judge provider — checking the
 * suite-level `evaluators` AND each case's per-case `evaluators`. Use this for
 * judge resolution instead of `hasLLMJudge(suite.evaluators)`, which misses
 * per-case evaluators and treats `rubric-checklist` as not needing a judge.
 */
export function suiteNeedsJudge(suite: Suite): boolean {
  if (specsNeedJudge(suite.evaluators)) return true;
  return suite.cases.some((c) => specsNeedJudge(c.evaluators));
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
