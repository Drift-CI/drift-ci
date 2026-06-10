import type { MessageParam, TokenUsage } from '../types/index.js';

export type { MessageParam };

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  cacheSystemPrompt?: boolean;
}

export interface CompletionResponse {
  text: string;
  usage: TokenUsage;
  model: string;
  latencyMs: number;
}

export interface ProviderAdapter {
  name: string;
  complete(
    input: string | MessageParam[],
    systemPrompt?: string,
    options?: CompletionOptions,
  ): Promise<CompletionResponse>;
}

export function toMessages(input: string | MessageParam[]): MessageParam[] {
  return typeof input === 'string'
    ? [{ role: 'user', content: input }]
    : input;
}
