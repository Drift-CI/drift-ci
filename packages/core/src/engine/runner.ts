import pLimit from 'p-limit';
import { randomUUID } from 'node:crypto';

import type {
  CaseResult,
  CaseStatus,
  RunResult,
  RunSummary,
  Suite,
  TestCase,
} from '../types/index.js';
import type { ProviderAdapter } from '../providers/base.js';
import type { EvaluatorChain } from '../evaluators/composite.js';
import type { StorageAdapter } from '../storage/interface.js';
import { classifyError } from './error-classifier.js';

export type EvaluatorForCase = (tc: TestCase) => EvaluatorChain;

export interface RunnerOptions {
  provider: ProviderAdapter;
  evaluator: EvaluatorChain | EvaluatorForCase;
  storage: StorageAdapter;
  concurrency?: number;
  timeoutMs?: number;
  defaultThreshold?: number;
  transientAbortRatio?: number;
  onCaseComplete?: (result: CaseResult) => void;
}

export const RUN_ABORTED_TRANSIENT = 'RUN_ABORTED_TRANSIENT';

export class RunAbortedTransientError extends Error {
  code = RUN_ABORTED_TRANSIENT;
  constructor(
    public transientCount: number,
    public totalCount: number,
  ) {
    super(
      `drift-ci: aborting run — ${transientCount}/${totalCount} cases failed with transient errors. ` +
        'This is likely a provider/network issue, not a behaviour regression.',
    );
    this.name = 'RunAbortedTransientError';
  }
}

const TRANSIENT_STATUSES: ReadonlySet<CaseStatus> = new Set([
  'provider-rate-limit',
  'provider-network',
  'timeout',
]);

export class Runner {
  private limit: ReturnType<typeof pLimit>;

  constructor(private opts: RunnerOptions) {
    this.limit = pLimit(opts.concurrency ?? 5);
  }

  async run(suite: Suite): Promise<RunResult> {
    const runId = randomUUID();
    const startedAt = new Date();
    const defaultThreshold =
      this.opts.defaultThreshold ?? suite.default_threshold ?? 0.1;

    const onCaseComplete = this.opts.onCaseComplete;
    const results = await Promise.all(
      suite.cases.map((tc) =>
        this.limit(async () => {
          const result = await this.runCase(runId, tc, defaultThreshold);
          onCaseComplete?.(result);
          return result;
        }),
      ),
    );

    const transientCount = results.filter((r) =>
      TRANSIENT_STATUSES.has(r.status),
    ).length;
    const ratio = this.opts.transientAbortRatio ?? 0.2;
    const transientThreshold = Math.max(
      3,
      Math.floor(results.length * ratio),
    );
    if (transientCount >= transientThreshold) {
      throw new RunAbortedTransientError(transientCount, results.length);
    }

    const run: RunResult = {
      id: runId,
      suiteId: suite.id,
      provider: this.opts.provider.name,
      startedAt,
      completedAt: new Date(),
      cases: results,
      summary: this.summarise(results),
    };

    await this.opts.storage.saveRun(run);
    return run;
  }

  private async runCase(
    runId: string,
    tc: TestCase,
    defaultThreshold: number,
  ): Promise<CaseResult> {
    const start = Date.now();
    const threshold = tc.threshold ?? defaultThreshold;
    const timeoutMs = this.opts.timeoutMs ?? 30_000;

    try {
      const providerInput = tc.messages ?? tc.input;
      if (providerInput === undefined) {
        throw new Error(
          `Case ${tc.id}: schema guarantees input XOR messages — one must be present`,
        );
      }

      let timeoutHandle: NodeJS.Timeout | undefined;
      const output = await Promise.race([
        this.opts.provider.complete(providerInput, tc.systemPrompt, {
          temperature: 0,
          maxTokens: tc.maxTokens,
        }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            const e = new Error('Timeout');
            (e as Error & { code?: string }).code = 'TIMEOUT';
            reject(e);
          }, timeoutMs);
        }),
      ]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });

      let score = 0;
      let evaluatorBreakdown: Record<string, unknown> | undefined;
      let evaluatorError: string | undefined;
      try {
        const evaluator =
          typeof this.opts.evaluator === 'function'
            ? this.opts.evaluator(tc)
            : this.opts.evaluator;
        const evalResult = await evaluator.evaluate({
          input:
            typeof tc.input === 'string'
              ? tc.input
              : JSON.stringify(tc.messages ?? tc.input),
          output: output.text,
          expected: tc.expected,
          criteria: tc.criteria,
          systemPrompt: tc.systemPrompt,
        });
        score = evalResult.score;
        evaluatorBreakdown = evalResult.metadata;
      } catch (evalErr) {
        evaluatorError = (evalErr as Error).message;
      }

      return {
        caseId: tc.id,
        runId,
        output: output.text,
        score: evaluatorError ? NaN : score,
        threshold,
        latencyMs: Date.now() - start,
        status: evaluatorError ? 'evaluator-error' : 'pass',
        error: evaluatorError,
        tokenUsage: output.usage,
        evaluatorBreakdown,
      };
    } catch (err) {
      const classified = classifyError(err as Error);
      return {
        caseId: tc.id,
        runId,
        output: null,
        score: NaN,
        threshold,
        latencyMs: Date.now() - start,
        status: classified,
        error: (err as Error).message,
      };
    }
  }

  private summarise(results: CaseResult[]): RunSummary {
    const scored = results.filter((r) => r.status === 'pass');
    const avgScore = scored.length
      ? scored.reduce((a, r) => a + r.score, 0) / scored.length
      : 0;
    const avgLatencyMs = results.length
      ? results.reduce((a, r) => a + r.latencyMs, 0) / results.length
      : 0;

    return {
      total: results.length,
      passed: scored.length,
      transient: results.filter((r) => TRANSIENT_STATUSES.has(r.status)).length,
      evaluatorErrors: results.filter((r) => r.status === 'evaluator-error')
        .length,
      failed: results.filter((r) => r.status === 'provider-auth').length,
      regressions: 0,
      avgScore,
      avgLatencyMs,
    };
  }
}
