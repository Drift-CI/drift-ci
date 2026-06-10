import type { CaseStatus } from '../types/index.js';

export function classifyError(err: Error): CaseStatus {
  const anyErr = err as { status?: number; code?: string; response?: { status?: number } };
  const status = anyErr.status ?? anyErr.response?.status;
  const code = anyErr.code ?? '';
  const msg = (err.message ?? '').toLowerCase();

  if (code === 'TIMEOUT' || msg.includes('timeout')) return 'timeout';
  if (status === 429 || msg.includes('rate limit')) return 'provider-rate-limit';
  if (status === 401 || status === 403) return 'provider-auth';
  if (
    (typeof status === 'number' && status >= 500) ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  ) {
    return 'provider-network';
  }

  return 'evaluator-error';
}
