export type CaseStatus =
  | 'pass'
  | 'evaluator-error'
  | 'provider-rate-limit'
  | 'provider-network'
  | 'provider-auth'
  | 'timeout';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
}

export interface CaseResult {
  caseId: string;
  runId: string;
  output: string | null;
  score: number;
  threshold: number;
  latencyMs: number;
  status: CaseStatus;
  error?: string;
  tokenUsage?: TokenUsage;
  evaluatorBreakdown?: Record<string, unknown>;
}

export interface RunSummary {
  total: number;
  passed: number;
  transient: number;
  evaluatorErrors: number;
  failed: number;
  regressions: number;
  avgScore: number;
  avgLatencyMs: number;
}

export interface RunResult {
  id: string;
  suiteId: string;
  provider: string;
  startedAt: Date;
  completedAt: Date;
  cases: CaseResult[];
  summary: RunSummary;
}
