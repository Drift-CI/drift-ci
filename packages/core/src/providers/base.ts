import type {
  ConversationTurn,
  MessageParam,
  TokenUsage,
  ToolCall,
  ToolDefinition,
  ToolResultContent,
} from '../types/index.js';

// Tool types are declared once, in types/suite.ts (ToolDefinition is the schema's inferred
// type), and re-exported here so adapters import everything provider-facing from base.ts.
export type { ConversationTurn, MessageParam, ToolCall, ToolDefinition, ToolResultContent };

/** What `complete` accepts: a prompt, plain messages, or a multi-step tool conversation. */
export type CompletionInput = string | MessageParam[] | ConversationTurn[];

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
    input: CompletionInput,
    systemPrompt?: string,
    options?: CompletionOptions,
  ): Promise<CompletionResponse>;
}

export function toMessages(input: string | MessageParam[]): MessageParam[] {
  return typeof input === 'string'
    ? [{ role: 'user', content: input }]
    : input;
}

/**
 * True when `input` is a tool conversation rather than plain text or messages: it has a `tool`
 * turn or an assistant turn with tool calls. Adapters map such input to their tool formats.
 */
export function isConversation(input: CompletionInput): input is ConversationTurn[] {
  return (
    Array.isArray(input) &&
    (input as ConversationTurn[]).some(
      (t) => t.role === 'tool' || (t.role === 'assistant' && (t.toolCalls?.length ?? 0) > 0),
    )
  );
}
