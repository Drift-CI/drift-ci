import type {
  CompletionInput,
  CompletionOptions,
  CompletionResponse,
  ConversationTurn,
  ProviderAdapter,
  ToolCall,
} from './base.js';
import { isConversation, toMessages } from './base.js';

/** Receives the input as-is, including a multi-step tool conversation. */
export type MockResponder = (
  input: CompletionInput,
  systemPrompt: string | undefined,
  options: CompletionOptions,
) => MockResult | Promise<MockResult> | Error;

/** A responder's reply: plain text, or text with the model's tool calls. */
export type MockResult = string | { text: string; toolCalls?: ToolCall[] };

export interface MockProviderOptions {
  name?: string;
  responses?: Record<string, string>;
  defaultResponse?: string;
  responder?: MockResponder;
  latencyMs?: number;
}

export class MockProvider implements ProviderAdapter {
  name: string;
  private responses: Record<string, string>;
  private defaultResponse: string;
  private responder?: MockResponder;
  private latencyMs: number;

  constructor(options: MockProviderOptions = {}) {
    this.name = options.name ?? 'mock/test-model';
    this.responses = options.responses ?? {};
    this.defaultResponse = options.defaultResponse ?? 'Mock response';
    this.responder = options.responder;
    this.latencyMs = options.latencyMs ?? 0;
  }

  async complete(
    input: CompletionInput,
    systemPrompt?: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResponse> {
    if (this.responder) {
      const result = await this.responder(input, systemPrompt, options);
      if (result instanceof Error) throw result;
      return this.wrap(result, input);
    }

    const key =
      typeof input === 'string'
        ? input
        : JSON.stringify(isConversation(input) ? input : toMessages(input));
    const text = this.responses[key] ?? this.defaultResponse;
    return this.wrap(text, input);
  }

  private wrap(result: MockResult, input: CompletionInput): CompletionResponse {
    const { text, toolCalls } = typeof result === 'string' ? { text: result, toolCalls: undefined } : result;
    return {
      text,
      ...(toolCalls !== undefined ? { toolCalls: withIds(toolCalls, input) } : {}),
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      model: this.name,
      latencyMs: this.latencyMs,
    };
  }
}

/**
 * Gives every call without an id a `call_<n>`, numbering on from the tool calls already in the
 * conversation, so ids stay unique across the steps of one conversation.
 */
function withIds(calls: ToolCall[], input: CompletionInput): ToolCall[] {
  const earlier = isConversation(input)
    ? input.reduce(
        (n, t: ConversationTurn) => n + (t.role === 'assistant' ? (t.toolCalls?.length ?? 0) : 0),
        0,
      )
    : 0;
  return calls.map((c, i) => (c.id !== undefined ? c : { id: `call_${earlier + i + 1}`, ...c }));
}
