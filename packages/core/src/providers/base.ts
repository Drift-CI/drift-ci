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

/** The number of tool calls the conversation's assistant turns already carry (0 for plain input). */
export function countToolCalls(input: CompletionInput): number {
  return isConversation(input)
    ? input.reduce(
        (n, t: ConversationTurn) => n + (t.role === 'assistant' ? (t.toolCalls?.length ?? 0) : 0),
        0,
      )
    : 0;
}

/**
 * Gives every call without an id a `call_<n>`, numbering on from the tool calls already in the
 * conversation, so ids stay unique across the steps of one conversation. Calls with an id (the
 * provider's own) keep it.
 */
export function withCallIds(calls: ToolCall[], input: CompletionInput): ToolCall[] {
  const earlier = countToolCalls(input);
  return calls.map((c, i) => (c.id !== undefined ? c : { ...c, id: `call_${earlier + i + 1}` }));
}

/** True for an id made by {@link withCallIds} rather than returned by a provider. */
export function isGeneratedCallId(id: string): boolean {
  return /^call_\d+$/.test(id);
}

/**
 * The id of the k-th (1-based) tool call in a conversation: its own, or the `call_<k>` that
 * {@link withCallIds} would have given it. Adapters use it when mapping turns, so a call that
 * somehow lost its id still pairs with a result echoing the generated one.
 */
export function callIdAt(call: ToolCall, ordinal: number): string {
  return call.id ?? `call_${ordinal}`;
}
