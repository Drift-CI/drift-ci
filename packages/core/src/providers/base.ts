import type { MessageParam, TokenUsage, ToolCall, ToolDefinition } from '../types/index.js';

// Tool types are declared once, in types/suite.ts (ToolDefinition is the schema's inferred
// type), and re-exported here so adapters import everything provider-facing from base.ts.
export type { MessageParam, ToolCall, ToolDefinition };

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  cacheSystemPrompt?: boolean;
  /** Tools offered to the model (automatic tool choice). Absent or empty: no tools are sent. */
  tools?: ToolDefinition[];
}

export interface CompletionResponse {
  text: string;
  usage: TokenUsage;
  model: string;
  latencyMs: number;
  /** The model's tool calls, set (possibly empty) only when tools were offered. */
  toolCalls?: ToolCall[];
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
