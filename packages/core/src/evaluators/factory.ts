import type { TestCase, EvaluatorSpec } from '../types/index.js';
import type { ProviderAdapter } from '../providers/base.js';
import type { Evaluator } from './base.js';
import { EvaluatorChain, type EvaluatorWeight } from './composite.js';
import { ExactMatchEvaluator } from './exact.js';
import { SchemaEvaluator } from './schema.js';
import { EmbeddingEvaluator } from './embedding.js';
import { LLMJudgeEvaluator } from './llm-judge.js';
import { RefusalDetectionEvaluator } from './refusal.js';
import {
  RubricChecklistEvaluator,
  type NamedJudge,
} from './rubric-checklist.js';
import {
  SafetyClassifierEvaluator,
  type SafetyClassifier,
} from './safety-classifier.js';

export interface EvaluatorFactoryContext {
  testProvider: ProviderAdapter;
  judgeProvider?: ProviderAdapter;
  case?: Pick<TestCase, 'schema' | 'rubric' | 'rubricQuorum'>;
  allowSelfBias?: boolean;
  /**
   * Resolved named judges from the top-level `judges:` config map.
   * Keyed by the same string the per-case `rubricQuorum.judges`
   * references. Required when a case uses `rubric-checklist` with
   * a `rubricQuorum` block.
   */
  judgesByKey?: Map<string, ProviderAdapter>;
  /**
   * Resolved safety classifier from the top-level `safetyClassifier:`
   * config block. Required when a case uses the `safety-classifier`
   * evaluator. Constructed once per run by the CLI/action runner and
   * passed in.
   */
  safetyClassifier?: SafetyClassifier;
  /** Optional category whitelist threaded through to the safety evaluator. */
  safetyBlockedCategories?: string[];
}

export function createEvaluatorChain(
  specs: EvaluatorSpec[] | undefined,
  ctx: EvaluatorFactoryContext,
): EvaluatorChain {
  if (!specs || specs.length === 0) {
    throw new Error(
      'At least one evaluator must be configured on the suite or case.',
    );
  }

  const norm = specs.map((s) => (typeof s === 'string' ? { name: s } : s));
  const explicit = norm.filter((s) => typeof s.weight === 'number');
  const implicit = norm.filter((s) => typeof s.weight !== 'number');
  const explicitSum = explicit.reduce((a, s) => a + (s.weight ?? 0), 0);
  const implicitShare =
    implicit.length > 0 ? (1 - explicitSum) / implicit.length : 0;

  const weighted: EvaluatorWeight[] = norm.map((s) => ({
    evaluator: build(s.name, ctx),
    weight: typeof s.weight === 'number' ? s.weight : implicitShare,
  }));

  return new EvaluatorChain(weighted);
}

function build(name: string, ctx: EvaluatorFactoryContext): Evaluator {
  switch (name) {
    case 'exact-match':
      return new ExactMatchEvaluator();
    case 'json-schema':
      return new SchemaEvaluator(ctx.case?.schema);
    case 'cosine-similarity':
      return new EmbeddingEvaluator();
    case 'llm-judge':
      return new LLMJudgeEvaluator({
        judgeProvider: ctx.judgeProvider ?? ctx.testProvider,
        testProviderName: ctx.testProvider.name,
        allowSelfBias: ctx.allowSelfBias,
      });
    case 'refusal-detection':
      return new RefusalDetectionEvaluator();
    case 'rubric-checklist': {
      if (!ctx.case?.rubric) {
        throw new Error(
          'rubric-checklist evaluator requires a `rubric` field on the test case.',
        );
      }
      const judges = resolveRubricJudges(ctx);
      return new RubricChecklistEvaluator({
        rubric: ctx.case.rubric,
        judges,
        threshold: ctx.case.rubricQuorum?.threshold,
        testProviderName: ctx.testProvider.name,
        allowSelfBias:
          ctx.case.rubricQuorum?.allowSelfBias ?? ctx.allowSelfBias,
      });
    }
    case 'safety-classifier': {
      if (!ctx.safetyClassifier) {
        throw new Error(
          'safety-classifier evaluator requires a `safetyClassifier` block in `.drift/config.yaml`. ' +
            'See arch §10 — pick `openai-moderation` or `llama-guard`.',
        );
      }
      return new SafetyClassifierEvaluator({
        classifier: ctx.safetyClassifier,
        blockedCategories: ctx.safetyBlockedCategories,
      });
    }
    default:
      throw new Error(`Unknown evaluator: ${name}`);
  }
}

function resolveRubricJudges(ctx: EvaluatorFactoryContext): NamedJudge[] {
  const quorum = ctx.case?.rubricQuorum;
  if (!quorum) {
    // No quorum configured — single-judge fallback uses the default
    // judge provider (or the test provider if none configured, which
    // the constructor will reject as self-bias unless allowSelfBias).
    const provider = ctx.judgeProvider ?? ctx.testProvider;
    return [{ key: 'default', provider }];
  }
  const map = ctx.judgesByKey;
  if (!map || map.size === 0) {
    throw new Error(
      'rubric-checklist: rubricQuorum.judges is set but no top-level `judges:` map was provided in the config.',
    );
  }
  const resolved: NamedJudge[] = [];
  const missing: string[] = [];
  for (const key of quorum.judges) {
    const provider = map.get(key);
    if (!provider) {
      missing.push(key);
      continue;
    }
    resolved.push({ key, provider });
  }
  if (missing.length > 0) {
    throw new Error(
      `rubric-checklist: rubricQuorum.judges references unknown key(s): ${missing.join(', ')}. ` +
        `Available: ${[...map.keys()].sort().join(', ') || '(none)'}.`,
    );
  }
  return resolved;
}
